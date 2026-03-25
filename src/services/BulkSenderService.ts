import { sendMessage, sendMediaMessage } from './whatsapp';

interface BulkMessageOptions {
  delay: number; // Delay in seconds
  sessionId?: string;
}

interface BulkSendResult {
  total: number;
  success: number;
  failed: number;
  errors: { number: string; error: any }[];
}

export const bulkSenderService = {
  /**
   * Send a message to multiple recipients with a delay
   */
  async sendBulkMessage(
    recipients: string[],
    message: string,
    mediaFile: Express.Multer.File | undefined,
    options: BulkMessageOptions,
  ): Promise<BulkSendResult> {
    const result: BulkSendResult = {
      total: recipients.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    const delayMs = options.delay * 1000;
    const sessionId = options.sessionId || 'default';

    console.log(
      `🚀 Starting Bulk Send to ${recipients.length} recipients. Delay: ${options.delay}s`,
    );

    for (const [index, number] of recipients.entries()) {
      try {
        // Format number (simple check, assume input is consistent for now)
        // Ensure it ends with @s.whatsapp.net if not already, or just pass number if sendMessage handles it.
        // Assuming sendMessage expects JID or number. whatsapp.ts usually constructs JID.
        // Let's assume input is just digits for now and let's construct JID if needed,
        // but sendMessage usually handles '123456@s.whatsapp.net'.
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;

        if (mediaFile) {
          let type: 'image' | 'document' | 'audio' | 'video' = 'document';
          if (mediaFile.mimetype.startsWith('image/')) type = 'image';
          else if (mediaFile.mimetype.startsWith('audio/')) type = 'audio';
          else if (mediaFile.mimetype.startsWith('video/')) type = 'video';

          const sent = await sendMediaMessage(
            jid,
            mediaFile.buffer,
            type,
            {
              caption: message || undefined,
              mimetype: mediaFile.mimetype,
              fileName: mediaFile.originalname,
            },
            sessionId,
          );

          if (!sent) {
            throw new Error('WhatsApp is not connected. Please scan the QR code first.');
          }
        } else {
          // Send Text only
          await sendMessage(jid, message, sessionId);
        }

        result.success++;
        console.log(
          `   ✅ [${index + 1}/${recipients.length}] Sent to ${number}`,
        );
      } catch (error: any) {
        console.error(
          `   ❌ [${index + 1}/${recipients.length}] Failed to ${number}:`,
          error.message,
        );
        result.failed++;
        result.errors.push({ number, error: error.message });
      }

      // Wait for delay (unless it's the last message)
      if (index < recipients.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    console.log(
      `🏁 Bulk Send Complete. Success: ${result.success}, Failed: ${result.failed}`,
    );
    return result;
  },
};
