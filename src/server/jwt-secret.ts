import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn(
    '⚠️ WARNING: JWT_SECRET environment variable not set. Using random secret for development. Set a secure secret in production.',
  );
}
if (JWT_SECRET && JWT_SECRET.length < 32) {
  console.warn(
    '⚠️ WARNING: JWT_SECRET should be at least 32 characters for security.',
  );
}

export const ACTUAL_JWT_SECRET =
  JWT_SECRET || crypto.randomBytes(32).toString('hex');
