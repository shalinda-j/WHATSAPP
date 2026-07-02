import { sendTyping, getSocket } from './whatsapp';
import {
  configurationManager,
  HumanizerConfig,
} from './ConfigurationManagerService';
import type { WASocket } from '@whiskeysockets/baileys';

interface QueuedMessage {
  jid: string;
  text: string;
  sessionId: string;
  attempts: number;
  timestamp: Date;
}

interface RateCaps {
  perMinute: number;
  perHour: number;
  perDay: number;
}

export class HumanizerService {
  private static messageQueue: QueuedMessage[] = [];
  private static isProcessingQueue = false;
  private static cachedConfig: HumanizerConfig | null = null;
  private static configCacheTime = 0;
  private static readonly CONFIG_CACHE_TTL = 60000; // 1 minute cache

  // Per-session send-rate tracking for Baileys ban-risk mitigation. Caps are
  // hot-reloadable from MongoDB Config (key='humanizer.rateCaps') and default
  // conservative values are tuned to stay well under WhatsApp's observed
  // anti-spam thresholds. In-memory only — sufficient for single-instance.
  private static sendTimestamps: Map<string, number[]> = new Map();
  private static dailyCount: Map<string, { date: string; count: number }> =
    new Map();
  // Hard cap so a deployment churning through unique sessionIds can't grow
  // these Maps unbounded. When exceeded we drop the oldest entry first
  // (insertion order is preserved by Map iteration). 50k sessions is well
  // above any realistic concurrent-tenant load on a single instance.
  private static readonly MAX_TRACKED_SESSIONS = 50_000;
  private static rateCapsCache: (RateCaps & { loadedAt: number }) | null = null;
  private static readonly RATE_CAPS_TTL = 60000;

  private static evictIfOversized(): void {
    while (
      HumanizerService.sendTimestamps.size >
      HumanizerService.MAX_TRACKED_SESSIONS
    ) {
      const oldest = HumanizerService.sendTimestamps.keys().next().value;
      if (!oldest) break;
      HumanizerService.sendTimestamps.delete(oldest);
    }
    while (
      HumanizerService.dailyCount.size > HumanizerService.MAX_TRACKED_SESSIONS
    ) {
      const oldest = HumanizerService.dailyCount.keys().next().value;
      if (!oldest) break;
      HumanizerService.dailyCount.delete(oldest);
    }
  }
  private static readonly DEFAULT_RATE_CAPS: RateCaps = {
    perMinute: 30,
    perHour: 600,
    perDay: 5000,
  };

  private static async getRateCaps(): Promise<RateCaps> {
    const now = Date.now();
    if (
      this.rateCapsCache &&
      now - this.rateCapsCache.loadedAt < this.RATE_CAPS_TTL
    ) {
      return this.rateCapsCache;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Config = require('../models/Config').default;
      const row = await Config.findOne({ key: 'humanizer.rateCaps' });
      let caps = { ...this.DEFAULT_RATE_CAPS };
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          caps = {
            perMinute: Number(parsed.perMinute ?? caps.perMinute),
            perHour: Number(parsed.perHour ?? caps.perHour),
            perDay: Number(parsed.perDay ?? caps.perDay),
          };
        } catch {
          /* malformed JSON — keep defaults */
        }
      }
      this.rateCapsCache = { ...caps, loadedAt: now };
      return caps;
    } catch {
      this.rateCapsCache = { ...this.DEFAULT_RATE_CAPS, loadedAt: now };
      return this.DEFAULT_RATE_CAPS;
    }
  }

  public static clearRateCapsCache(): void {
    this.rateCapsCache = null;
  }

  private static async checkRateCap(sessionId: string): Promise<{
    allowed: boolean;
    reason?: 'per_minute' | 'per_hour' | 'per_day';
  }> {
    const caps = await this.getRateCaps();
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const hourAgo = now - 3_600_000;
    const todayKey = new Date(now).toISOString().slice(0, 10);

    const ts = this.sendTimestamps.get(sessionId) ?? [];
    const recent = ts.filter((t) => t > hourAgo);
    this.sendTimestamps.set(sessionId, recent);

    const last1m = recent.filter((t) => t > minuteAgo).length;
    const last1h = recent.length;

    let day = this.dailyCount.get(sessionId);
    if (!day || day.date !== todayKey) {
      day = { date: todayKey, count: 0 };
      this.dailyCount.set(sessionId, day);
    }

    if (last1m >= caps.perMinute)
      return { allowed: false, reason: 'per_minute' };
    if (last1h >= caps.perHour) return { allowed: false, reason: 'per_hour' };
    if (day.count >= caps.perDay) return { allowed: false, reason: 'per_day' };
    return { allowed: true };
  }

  private static recordSend(sessionId: string): void {
    const now = Date.now();
    const ts = this.sendTimestamps.get(sessionId) ?? [];
    ts.push(now);
    this.sendTimestamps.set(sessionId, ts);
    const todayKey = new Date(now).toISOString().slice(0, 10);
    let day = this.dailyCount.get(sessionId);
    if (!day || day.date !== todayKey) {
      day = { date: todayKey, count: 0 };
      this.dailyCount.set(sessionId, day);
    }
    day.count++;
    // Cheap evict-on-write; the LRU-ish drop of the first-inserted key is
    // safe because the only consumers of these maps are rate caps + stats,
    // and a long-dormant session being evicted just resets its rate window.
    HumanizerService.evictIfOversized();
  }

  public static getRateStats(sessionId: string): {
    last1m: number;
    last1h: number;
    today: number;
  } {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const hourAgo = now - 3_600_000;
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const ts = this.sendTimestamps.get(sessionId) ?? [];
    const day = this.dailyCount.get(sessionId);
    return {
      last1m: ts.filter((t) => t > minuteAgo).length,
      last1h: ts.filter((t) => t > hourAgo).length,
      today: day?.date === todayKey ? day.count : 0,
    };
  }

  // MEMORY LEAK FIX: Add cleanup interval and max age for queued messages
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static readonly MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // 30 minutes max age

  /**
   * MEMORY LEAK FIX: Initialize cleanup interval
   */
  public static initializeCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldMessages();
      },
      5 * 60 * 1000,
    ); // Clean every 5 minutes
  }

  /**
   * MEMORY LEAK FIX: Remove old queued messages
   */
  private static cleanupOldMessages(): void {
    const now = Date.now();
    const cutoff = now - this.MAX_QUEUE_AGE_MS;

    const oldCount = this.messageQueue.length;
    this.messageQueue = this.messageQueue.filter(
      (msg) => msg.timestamp.getTime() > cutoff,
    );

    if (this.messageQueue.length < oldCount) {
      console.log(
        `🧹 HumanizerService: Removed ${
          oldCount - this.messageQueue.length
        } old queued messages`,
      );
    }

    // Also clear stale config cache
    if (
      this.cachedConfig &&
      now - this.configCacheTime > this.CONFIG_CACHE_TTL
    ) {
      this.cachedConfig = null;
      this.configCacheTime = 0;
    }
  }

  /**
   * MEMORY LEAK FIX: Shutdown cleanup
   */
  public static shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.messageQueue = [];
    this.cachedConfig = null;
    this.configCacheTime = 0;
    console.log('🧹 HumanizerService: Shutdown cleanup completed');
  }

  /**
   * Helper function to wait for a specific amount of time
   */
  private static async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets a random delay between min and max (in milliseconds)
   */
  private static getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  /**
   * Get humanizer config with caching
   */
  private static async getConfig(): Promise<HumanizerConfig> {
    const now = Date.now();
    if (
      this.cachedConfig &&
      now - this.configCacheTime < this.CONFIG_CACHE_TTL
    ) {
      return this.cachedConfig;
    }

    this.cachedConfig = await configurationManager.getHumanizerConfig();
    this.configCacheTime = now;
    return this.cachedConfig;
  }

  /**
   * Clear config cache (call when settings are updated)
   */
  public static clearConfigCache(): void {
    this.cachedConfig = null;
    this.configCacheTime = 0;
    configurationManager.clearCache(); // Clear the main config cache as well
    console.log('🧹 Humanizer config cache cleared');
  }

  /**
   * Add message to queue for retry when connection is unavailable
   */
  private static async queueMessage(
    jid: string,
    text: string,
    sessionId: string,
  ): Promise<void> {
    const config = await this.getConfig();
    if (this.messageQueue.length >= config.maxQueueSize) {
      console.warn('⚠️ Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push({
      jid,
      text,
      sessionId,
      attempts: 0,
      timestamp: new Date(),
    });
    console.log(
      `📬 Message queued for ${jid} (queue size: ${this.messageQueue.length})`,
    );
    this.processQueue();
  }

  /**
   * Process queued messages when connection is restored
   */
  private static async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.messageQueue.length === 0) return;

    this.isProcessingQueue = true;
    const config = await this.getConfig();

    // The queue is SHARED across all sessions, so a blocked head-of-queue
    // message (rate-capped session, or one with no socket) must NOT stall every
    // other session behind it. Blocked messages are ROTATED to the tail so
    // sendable messages for other sessions proceed. `consecutiveSkips` counts
    // rotations since the last real progress (send/drop); once it reaches the
    // queue length every remaining message is blocked, so we sleep ONCE per
    // full pass instead of busy-rotating.
    let consecutiveSkips = 0;
    const rotateToTail = () => {
      const head = this.messageQueue.shift();
      if (head) this.messageQueue.push(head);
      consecutiveSkips++;
    };

    while (this.messageQueue.length > 0) {
      if (consecutiveSkips >= this.messageQueue.length) {
        // A full pass with no progress — everything is blocked. Sleep once,
        // then re-attempt the whole queue (cap windows free / sockets return).
        await this.sleep(config.retryDelayMs);
        consecutiveSkips = 0;
      }

      const msg = this.messageQueue[0];
      const sock = getSocket(msg.sessionId);

      if (!sock) {
        // No socket for this session. Drop after maxRetries, else rotate so
        // other sessions aren't starved while this one is down.
        if (msg.attempts >= config.maxRetries) {
          console.error(
            `❌ Max retries reached for queued message to ${msg.jid}, dropping`,
          );
          this.messageQueue.shift();
          consecutiveSkips = 0; // a drop is progress
          continue;
        }
        msg.attempts++;
        rotateToTail();
        continue;
      }

      // Honor the per-session rate cap when DRAINING the queue too. Without
      // this the cap is a no-op: messages rejected by checkRateCap in
      // sendHumanizedMessage are queued here and flushed instantly, uncounted —
      // so the perMinute/perHour/perDay Baileys ban-risk caps never throttle
      // anything. Rotate the capped message to the tail (do NOT consume a retry
      // attempt — a cap is transient, not a failure) so a per-day-capped
      // session can't block every other session's sends.
      const rate = await this.checkRateCap(msg.sessionId);
      if (!rate.allowed) {
        rotateToTail();
        continue;
      }

      // Try to send the queued message
      try {
        const sent = await this.sendDirectly(
          sock,
          msg.jid,
          msg.text,
          msg.sessionId,
        );
        // Count the send against the cap (the direct path records too) so
        // queued sends can't silently bypass the throttle.
        if (sent) this.recordSend(msg.sessionId);
        this.messageQueue.shift();
        consecutiveSkips = 0; // progress
        console.log(`✅ Queued message sent to ${msg.jid}`);
      } catch (error) {
        console.error(`❌ Failed to send queued message to ${msg.jid}:`, error);
        if (msg.attempts >= config.maxRetries) {
          this.messageQueue.shift();
          consecutiveSkips = 0; // a drop is progress
        } else {
          // Rotate rather than block the head on a single failing message.
          msg.attempts++;
          rotateToTail();
        }
      }
    }

    this.isProcessingQueue = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WhatsApp text sanitizer
  //
  // AI models are trained on markdown-heavy corpora and frequently output
  // **double-asterisk bold**, # headings, and markdown bullet points.
  // WhatsApp has its own formatting rules:
  //   *single asterisk* → bold (the only supported bold syntax)
  //   _single underscore_ → italic
  //   ~tilde~ → strikethrough
  //
  // Double asterisks (**) are NOT bold in WhatsApp — they appear as two
  // literal star characters on both sides of the word, making messages look
  // broken and unprofessional. This sanitizer converts AI output to clean
  // WhatsApp-native formatting before every outbound message.
  // ─────────────────────────────────────────────────────────────────────────
  public static sanitizeForWhatsApp(text: string): string {
    if (!text) return text;
    let s = text;

    // 1. Triple/quad asterisks (***bold*** or ****bold****) → *bold*
    s = s.replace(/\*{3,}([^*\n]{1,300}?)\*{3,}/g, '*$1*');

    // 2. Double asterisks (**bold**) → *bold*  [WhatsApp bold]
    s = s.replace(/\*\*([^*\n]{1,300}?)\*\*/g, '*$1*');

    // 3. Double underscores (__italic__) → _italic_  [WhatsApp italic]
    s = s.replace(/__([^_\n]{1,300}?)__/g, '_$1_');

    // 4. Markdown headings (# Title / ## Title / ### Title) → plain text
    //    Strip the leading # characters; keep the heading text itself.
    s = s.replace(/^#{1,6}[ \t]+/gm, '');

    // 5. Markdown bullet points at line start (- item  or  * item) → • item
    //    Only match when the asterisk is followed by whitespace (a bullet),
    //    not when it's followed by text (already-converted WhatsApp *bold*).
    s = s.replace(/^[ \t]*-[ \t]+/gm, '• ');
    s = s.replace(/^[ \t]*\*[ \t]+/gm, '• ');

    // 6. Strip trailing whitespace per line (markdown adds 2+ spaces for <br>)
    s = s.replace(/[ \t]+$/gm, '');

    // 7. Collapse 3+ consecutive blank lines → single blank line
    //    WhatsApp renders each blank line as visible vertical space; three
    //    or more make the message feel like a formal document.
    s = s.replace(/\n{3,}/g, '\n\n');

    return s.trim();
  }

  /**
   * Send message directly without queueing
   */
  private static async sendDirectly(
    sock: WASocket,
    jid: string,
    text: string,
    sessionId: string,
  ): Promise<boolean> {
    if (!sock) {
      throw new Error('Socket not available');
    }

    // Sanitize markdown formatting before every send — AI models frequently
    // output **double-asterisk bold** which shows as literal stars in WhatsApp.
    const cleanText = HumanizerService.sanitizeForWhatsApp(text);

    const config = await this.getConfig();

    // Check if humanizer is enabled
    if (!config.enabled) {
      // Send immediately without delays
      console.log(`📤 Sending message immediately (humanizer disabled)`);
      await sock.sendMessage(jid, { text: cleanText });
      return true;
    }

    // 1. Initial reaction delay (simulate reading the message before typing)
    const reactionDelay = this.getRandomDelay(
      config.reactionDelayMin,
      config.reactionDelayMax,
    );
    await this.sleep(reactionDelay);

    // 2. Calculate typing duration based on typing speed
    const charCount = cleanText.length;
    const charsPerSecond = config.typingSpeedCharsPerMin / 60;
    let typingDelay = Math.floor((charCount / charsPerSecond) * 1000);
    const variance = typingDelay * 0.15;
    typingDelay = typingDelay + this.getRandomDelay(-variance, variance);
    typingDelay = Math.max(
      config.minTypingDelayMs,
      Math.min(typingDelay, config.maxTypingDelayMs),
    );

    console.log(
      `   ⏳ Humanizer: Intentionally delaying for ${Math.round(
        typingDelay / 1000,
      )}s while typing...`,
    );

    // 3. Send typing indicator
    await sendTyping(jid, sessionId);

    // 4. Wait for the calculated typing duration
    await this.sleep(typingDelay);

    // 5. Send the actual message
    console.log(
      `📤 Sending humanized message to ${jid} using session: ${sessionId}`,
    );
    await sock.sendMessage(jid, { text: cleanText });

    return true;
  }

  /**
   * Simulates a human sending a message.
   * Calculates typing time based on message length, waits, and then sends.
   * If socket is unavailable, queues the message for retry.
   */
  public static async sendHumanizedMessage(
    jid: string,
    text: string,
    sessionId = 'default',
  ): Promise<boolean> {
    // Preserve the historic boolean contract for the many conversational
    // callers: true only when the message went out immediately.
    const r = await this.sendHumanizedMessageDetailed(jid, text, sessionId);
    return r.delivered;
  }

  /**
   * Richer variant of sendHumanizedMessage that distinguishes immediate
   * delivery from "queued for later". Campaign/marketing senders MUST use this
   * so a queued message is not mis-recorded as a hard failure (which would
   * double-send on the next relaunch and undercount stats.sent).
   */
  public static async sendHumanizedMessageDetailed(
    jid: string,
    text: string,
    sessionId = 'default',
  ): Promise<{ delivered: boolean; queued: boolean }> {
    const rate = await this.checkRateCap(sessionId);
    if (!rate.allowed) {
      console.warn(
        `⚠️ Rate cap hit (${rate.reason}) for session '${sessionId}' — queueing for later delivery`,
      );
      await this.queueMessage(jid, text, sessionId);
      return { delivered: false, queued: true };
    }

    const sock = getSocket(sessionId);

    if (!sock) {
      console.warn(
        `⚠️ sendHumanizedMessage: Session '${sessionId}' socket not available. Queueing message...`,
      );
      await this.queueMessage(jid, text, sessionId);
      return { delivered: false, queued: true };
    }

    try {
      const sent = await this.sendDirectly(sock, jid, text, sessionId);
      if (sent) this.recordSend(sessionId);
      return { delivered: sent, queued: false };
    } catch (error) {
      console.error('❌ Error sending humanized message:', error);
      // Queue for retry on error
      await this.queueMessage(jid, text, sessionId);
      return { delivered: false, queued: true };
    }
  }

  /**
   * Get current queue size (for monitoring)
   */
  public static getQueueSize(): number {
    return this.messageQueue.length;
  }

  /**
   * Clear the message queue
   */
  public static clearQueue(): void {
    this.messageQueue = [];
  }

  /**
   * Trigger queue processing (call when connection is restored)
   */
  public static triggerQueueProcessing(): void {
    this.processQueue();
  }
}
