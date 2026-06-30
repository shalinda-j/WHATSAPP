import mongoose from 'mongoose';
import Tenant, { ITenant } from '../models/Tenant';

const LEGACY_COLLECTIONS = [
  'leads',
  'contacts',
  'deals',
  'activities',
  'pipelinestages',
  'bookings',
  'chatmessages',
  'conversationhistories',
  'formsubmissions',
  'formtemplates',
  'knowledgeentries',
  'sessions',
  'sessionstates',
  'calllogs', // Mongoose pluralizes model 'CallLog' to 'calllogs' (three L's)
  'voiceconfigs',
  'webhooks',
  'workflows',
  'datasets',
  'admins',
  'configs',
] as const;

export interface BootstrapResult {
  tenant: ITenant;
  created: boolean;
  migrated: Array<{ collection: string; modified: number }>;
}

// The resolved default-tenant _id, cached at boot by ensureDefaultTenantAndMigrate.
// Lets non-HTTP code paths that lack a resolveTenant middleware (WhatsApp
// command handlers, etc.) tag their writes with the default tenant the same way
// index.ts does, without a per-call DB lookup or a circular import on index.ts.
let cachedDefaultTenantId: string | null = null;

/** The default-tenant id resolved at boot, or null before bootstrap runs. */
export function getDefaultTenantId(): string | null {
  return cachedDefaultTenantId;
}

/**
 * Boot-time multi-tenant migration. Runs once per process startup:
 *   1. Finds or creates the 'default' Tenant.
 *   2. For every legacy collection in LEGACY_COLLECTIONS, runs
 *        updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } })
 *      so existing single-tenant data gets tagged with the default tenant
 *      without operator intervention. Idempotent — second boot is a no-op.
 *
 * This is the cheap, can't-go-wrong version of the standalone migration
 * script (src/scripts/migrate-tenant-id.ts). The standalone script
 * remains useful for non-default slugs and dry-runs.
 *
 * Safety:
 *   - Runs against the live mongoose connection only — if Mongo is down
 *     at boot, the caller's existing try/catch swallows the failure and
 *     the server continues in LIMITED MODE (existing behaviour).
 *   - Uses `tenantId: { $exists: false }` so any operator who already
 *     manually scoped rows to a different tenant won't get clobbered.
 *   - Returns the per-collection count so the boot logs make the
 *     migration visible.
 */
export async function ensureDefaultTenantAndMigrate(): Promise<BootstrapResult> {
  let tenant = await Tenant.findOne({ slug: 'default' });
  let created = false;
  if (!tenant) {
    tenant = await Tenant.create({
      slug: 'default',
      name: 'Default Tenant',
      plan: 'free',
      status: 'active',
    });
    created = true;
    console.log('🏢 Created default tenant');
  }
  cachedDefaultTenantId = String(tenant._id);

  const migrated: BootstrapResult['migrated'] = [];
  const db = mongoose.connection.db;
  if (db) {
    for (const collName of LEGACY_COLLECTIONS) {
      try {
        const coll = db.collection(collName);
        const result = await coll.updateMany(
          { tenantId: { $exists: false } },
          { $set: { tenantId: tenant._id } },
        );
        if (result.modifiedCount > 0) {
          migrated.push({
            collection: collName,
            modified: result.modifiedCount,
          });
        }
      } catch (err) {
        // Collection might not exist yet on a fresh DB — that's fine.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          !msg.includes('ns not found') &&
          !msg.includes('NamespaceNotFound')
        ) {
          console.error(
            `ensureDefaultTenantAndMigrate: ${collName} failed:`,
            msg,
          );
        }
      }
    }
  }

  if (migrated.length > 0) {
    const total = migrated.reduce((s, m) => s + m.modified, 0);
    console.log(
      `🔁 Auto-migrated ${total} legacy row(s) to default tenant: ${migrated
        .map((m) => `${m.collection}:${m.modified}`)
        .join(', ')}`,
    );
  }

  // ConversationHistory moved from a userId-only unique index to a compound
  // { userId, tenantId } unique index. Mongoose never drops the legacy
  // `userId_1` index, and keeping it makes ANY history writer that omits
  // tenantId (e.g. the WhatsApp command path) collide with the tenant-scoped
  // main path on a cross-filter insert → E11000 on every subsequent message
  // for that JID. The backfill above has now stamped tenantId on every row, so
  // each (userId, tenantId) pair is unique. We (1) ensure the compound unique
  // index exists, then ONLY on success (2) drop the legacy single-field index.
  // Both steps are idempotent and fail-safe: if the compound index can't be
  // built we keep userId_1 as the guarantee rather than leaving the collection
  // unconstrained.
  if (db) {
    try {
      const coll = db.collection('conversationhistories');
      await coll.createIndex({ userId: 1, tenantId: 1 }, { unique: true });
      try {
        await coll.dropIndex('userId_1');
        console.log('🔧 Dropped legacy conversationhistories.userId_1 index');
      } catch {
        // Already absent (fresh DB or prior boot) — fine.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('ns not found') && !msg.includes('NamespaceNotFound')) {
        console.warn(
          'ConversationHistory index migration skipped (kept legacy index):',
          msg,
        );
      }
    }
  }

  return { tenant, created, migrated };
}
