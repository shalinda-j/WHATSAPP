import crypto from 'crypto';

// SECURITY: Fail fast in production if JWT_SECRET is missing; otherwise
// generate a throwaway dev secret (all tokens become invalid after restart).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '❌ FATAL: JWT_SECRET environment variable is not set. ' +
        'Set a secure JWT_SECRET (at least 32 characters) in production — ' +
        'refusing to start with an ephemeral secret, as it would invalidate ' +
        'all issued tokens on every restart and weaken auth.',
    );
  }
  console.warn(
    '⚠️ WARNING: JWT_SECRET environment variable not set. Generating a random ' +
      'development secret. All issued tokens will be invalidated on restart. ' +
      'Set a secure secret in production.',
  );
}
if (JWT_SECRET && JWT_SECRET.length < 32) {
  console.warn(
    '⚠️ WARNING: JWT_SECRET should be at least 32 characters for security.',
  );
}

export const ACTUAL_JWT_SECRET =
  JWT_SECRET || crypto.randomBytes(32).toString('hex');
