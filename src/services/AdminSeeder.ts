/**
 * Boot-time admin seeder.
 *
 * If NO admin account exists yet, create a super-admin from environment
 * credentials so a fresh deploy can log in immediately instead of silently
 * requiring the operator to POST /api/auth/setup. The README documents
 * ADMIN_USERNAME / ADMIN_PASSWORD, but without this seeder those vars were
 * ignored and no login was ever created.
 *
 * Safety:
 *  - Only ever creates an admin when the collection is EMPTY. It never edits or
 *    overwrites an existing admin, and never changes a password.
 *  - Tolerates the `ADMIN_PASSWOR` misspelling present in some live deploys.
 *  - Skips (with a clear log) when creds are missing or too weak.
 */
import bcrypt from 'bcrypt';
import Admin from '../models/Admin';
import { SUPER_ADMIN_ROLE } from '../server/middleware/auth';

export async function seedAdminFromEnv(): Promise<void> {
  try {
    const count = await Admin.countDocuments();
    if (count > 0) return; // an admin already exists — do nothing

    const username = (
      process.env.SUPER_ADMIN_USERNAME ||
      process.env.ADMIN_USERNAME ||
      ''
    ).trim();
    // Accept the documented names plus the ADMIN_PASSWOR typo seen in deploys.
    const password =
      process.env.SUPER_ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWOR ||
      '';

    if (!username || !password) {
      console.warn(
        '👤 No admin exists and SUPER_ADMIN_/ADMIN_ env credentials are not set — create one via the setup screen (POST /api/auth/setup).',
      );
      return;
    }
    if (password.length < 8) {
      console.warn(
        '👤 Admin seed skipped: env password is too short (min 8 characters).',
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash, role: SUPER_ADMIN_ROLE });
    console.log(
      `👤 Seeded super-admin '${username}' from environment credentials.`,
    );
  } catch (err) {
    // Fail open — a seeder error must never crash the boot sequence.
    console.error('seedAdminFromEnv failed:', (err as Error).message);
  }
}
