import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// SECURITY: Generate a default key if ENCRYPTION_KEY is not configured
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey) {
  console.warn('⚠️ WARNING: ENCRYPTION_KEY environment variable not set. Using default key for development. Set a secure 32-character key in production.');
}
if (rawKey && rawKey.length < 32) {
  console.warn('⚠️ WARNING: ENCRYPTION_KEY should be exactly 32 characters for AES-256.');
}
// Use provided key or generate a random one for development
const ENCRYPTION_KEY = Buffer.from(
  (rawKey || crypto.randomBytes(32).toString('hex')).slice(0, 32)
);

export class CryptoService {
  static encrypt(text: string | undefined): string | undefined {
    if (!text || text.trim() === '') return text;
    // Check if already encrypted (IV hex is 32 chars long)
    if (text.includes(':') && text.split(':')[0].length === 32) return text;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(
        ALGORITHM,
        ENCRYPTION_KEY as any,
        iv as any,
      );
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
      console.error('Encryption error:', e);
      return text;
    }
  }

  static decrypt(text: string | undefined): string | undefined {
    // If empty or plain text (no colon)
    if (!text || !text.includes(':')) return text;

    try {
      const textParts = text.split(':');
      const ivHex = textParts.shift();
      if (!ivHex || ivHex.length !== 32) return text; // Not our IV format

      const iv = Buffer.from(ivHex, 'hex');
      const encryptedText = textParts.join(':');

      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        ENCRYPTION_KEY as any,
        iv as any,
      );
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error(
        'Decryption error, returning raw text. Please reset your API keys:',
        error,
      );
      return text;
    }
  }
}
