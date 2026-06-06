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
  'callogs',
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

  return { tenant, created, migrated };
}
