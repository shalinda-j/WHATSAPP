import { sendTyping, getSocket } from './whatsapp';
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
  private static readonly MAX_QUEUE_SIZE = 100;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 5000;

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
   * Add message to queue for retry when connection is unavailable
   */
  private static queueMessage(
    jid: string,
    text: string,
    sessionId: string,
  ): void {
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
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

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue[0];
      const sock = getSocket(msg.sessionId);

      if (!sock) {
        // No socket available, wait and retry
        if (msg.attempts >= this.MAX_RETRIES) {
          console.error(
            `❌ Max retries reached for queued message to ${msg.jid}, dropping`,
          );
          this.messageQueue.shift();
          continue;
        }

        msg.attempts++;
        console.log(
          `⏳ No socket available, waiting ${
            this.RETRY_DELAY_MS / 1000
          }s before retry (${msg.attempts}/${this.MAX_RETRIES})`,
        );
        await this.sleep(this.RETRY_DELAY_MS);
        continue;
      }

      // Try to send the queued message
      try {
        await this.sendDirectly(sock, msg.jid, msg.text, msg.sessionId);
        this.messageQueue.shift();
        console.log(`✅ Queued message sent to ${msg.jid}`);
      } catch (error) {
        console.error(`❌ Failed to send queued message to ${msg.jid}:`, error);
        if (msg.attempts >= this.MAX_RETRIES) {
          this.messageQueue.shift();
        } else {
          msg.attempts++;
          await this.sleep(this.RETRY_DELAY_MS);
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

    // 1. Initial reaction delay (simulate reading the message before typing)
    const reactionDelay = this.getRandomDelay(1000, 2500);
    await this.sleep(reactionDelay);

    // 2. Calculate typing duration (avg 250 chars per minute ~ 4 chars per second)
    const charCount = text.length;
    let typingDelay = Math.floor((charCount / 4) * 1000);
    const variance = typingDelay * 0.15;
    typingDelay = typingDelay + this.getRandomDelay(-variance, variance);
    typingDelay = Math.max(1500, Math.min(typingDelay, 8000));

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
      this.queueMessage(jid, text, sessionId);
      return false;
    }

    try {
      return await this.sendDirectly(sock, jid, text, sessionId);
    } catch (error) {
      console.error('❌ Error sending humanized message:', error);
      // Queue for retry on error
      this.queueMessage(jid, text, sessionId);
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
