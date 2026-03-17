import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
// Ensure a 32-byte key
const rawKey =
  process.env.ENCRYPTION_KEY || 'default_secret_key_change_in_prod_now';
const ENCRYPTION_KEY = Buffer.from(rawKey.padEnd(32, '0').slice(0, 32));
const IV_LENGTH = 16;

// Warn if using default encryption key in production
if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️ WARNING: Using default ENCRYPTION_KEY in production is insecure!',
  );
}

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
