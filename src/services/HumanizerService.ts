import { sendTyping, getSocket } from './whatsapp';
import { configurationManager, HumanizerConfig } from './ConfigurationManagerService';
import type { WASocket } from '@whiskeysockets/baileys';

interface QueuedMessage {
  jid: string;
  text: string;
  sessionId: string;
  attempts: number;
  timestamp: Date;
}

export class HumanizerService {
  private static messageQueue: QueuedMessage[] = [];
  private static isProcessingQueue = false;
  private static cachedConfig: HumanizerConfig | null = null;
  private static configCacheTime = 0;
  private static readonly CONFIG_CACHE_TTL = 60000; // 1 minute cache

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
    if (this.cachedConfig && now - this.configCacheTime < this.CONFIG_CACHE_TTL) {
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

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue[0];
      const sock = getSocket(msg.sessionId);

      if (!sock) {
        // No socket available, wait and retry
        if (msg.attempts >= config.maxRetries) {
          console.error(
            `❌ Max retries reached for queued message to ${msg.jid}, dropping`,
          );
          this.messageQueue.shift();
          continue;
        }

        msg.attempts++;
        console.log(
          `⏳ No socket available, waiting ${
            config.retryDelayMs / 1000
          }s before retry (${msg.attempts}/${config.maxRetries})`,
        );
        await this.sleep(config.retryDelayMs);
        continue;
      }

      // Try to send the queued message
      try {
        await this.sendDirectly(sock, msg.jid, msg.text, msg.sessionId);
        this.messageQueue.shift();
        console.log(`✅ Queued message sent to ${msg.jid}`);
      } catch (error) {
        console.error(`❌ Failed to send queued message to ${msg.jid}:`, error);
        if (msg.attempts >= config.maxRetries) {
          this.messageQueue.shift();
        } else {
          msg.attempts++;
          await this.sleep(config.retryDelayMs);
        }
      }
    }

    this.isProcessingQueue = false;
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

    const config = await this.getConfig();

    // Check if humanizer is enabled
    if (!config.enabled) {
      // Send immediately without delays
      console.log(`📤 Sending message immediately (humanizer disabled)`);
      await sock.sendMessage(jid, { text });
      return true;
    }

    // 1. Initial reaction delay (simulate reading the message before typing)
    const reactionDelay = this.getRandomDelay(config.reactionDelayMin, config.reactionDelayMax);
    await this.sleep(reactionDelay);

    // 2. Calculate typing duration based on typing speed
    const charCount = text.length;
    const charsPerSecond = config.typingSpeedCharsPerMin / 60;
    let typingDelay = Math.floor((charCount / charsPerSecond) * 1000);
    const variance = typingDelay * 0.15;
    typingDelay = typingDelay + this.getRandomDelay(-variance, variance);
    typingDelay = Math.max(config.minTypingDelayMs, Math.min(typingDelay, config.maxTypingDelayMs));

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
    await sock.sendMessage(jid, { text });

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
    const sock = getSocket(sessionId);

    if (!sock) {
      console.warn(
        `⚠️ sendHumanizedMessage: Session '${sessionId}' socket not available. Queueing message...`,
      );
      await this.queueMessage(jid, text, sessionId);
      return false;
    }

    try {
      return await this.sendDirectly(sock, jid, text, sessionId);
    } catch (error) {
      console.error('❌ Error sending humanized message:', error);
      // Queue for retry on error
      await this.queueMessage(jid, text, sessionId);
      return false;
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