import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// SECURITY: Fail fast in production if ENCRYPTION_KEY is missing; otherwise
// generate a throwaway dev key (data encrypted with it will NOT survive a
// restart).
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '❌ FATAL: ENCRYPTION_KEY environment variable is not set. ' +
        'Set a secure 32-character ENCRYPTION_KEY in production — refusing to ' +
        'start with an ephemeral key, as it would make every stored secret ' +
        'unrecoverable after restart.',
    );
  }
  console.warn(
    '⚠️ WARNING: ENCRYPTION_KEY environment variable not set. Generating a ' +
      'random development key. Encrypted data will NOT survive a restart. ' +
      'Set a secure 32-character key in production.',
  );
}
if (rawKey && rawKey.length !== 32) {
  console.warn(
    '⚠️ WARNING: ENCRYPTION_KEY should be exactly 32 characters for AES-256 ' +
      `(got ${rawKey.length}).`,
  );
}
// Use provided key or generate a random one for development. Keep the
// slice(0,32) behaviour so already-encrypted data still decrypts.
const ENCRYPTION_KEY = Buffer.from(
  (rawKey || crypto.randomBytes(32).toString('hex')).slice(0, 32),
);

export class CryptoService {
  static encrypt(text: string | undefined): string | undefined {
    if (!text || text.trim() === '') return text;
    // Already-encrypted check: our format is `<32 hex-char IV>:<cipher>`.
    // Require the prefix to be 32 HEX chars (not merely 32 chars) so a
    // plaintext secret that happens to have a 32-char first colon-segment
    // isn't mistaken for ciphertext and stored unencrypted (it would then read
    // back as '' when decrypt fails on the non-hex IV).
    if (/^[0-9a-f]{32}:/i.test(text)) return text;

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
      // Return an EMPTY STRING (NOT the raw ciphertext) so callers can detect
      // a bad key. The old behaviour returned the encrypted blob — every
      // caller then tried to use it as if it were the real value, causing
      // downstream API calls to fail with 401/400. '' is falsy like the
      // missing value, so the load balancer skips this provider cleanly while
      // the return type stays a plain string.
      console.error(
        '❌ Decryption failed (possible ENCRYPTION_KEY mismatch) — cannot decrypt stored value. ' +
          'The ENCRYPTION_KEY env var is different from when this value was saved. ' +
          'Either restore the original ENCRYPTION_KEY or re-enter the value via Admin Panel. ' +
          'Error:',
        (error as Error).message || error,
      );
      return '';
    }
  }
}
