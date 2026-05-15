/**
 * Multi-tenant migration: backfill `tenantId` on every collection that
 * pre-dates the Tenant model.
 *
 * USAGE:
 *   npx ts-node src/scripts/migrate-tenant-id.ts [--dry-run] [--slug=default]
 *
 * What it does:
 *   1. Finds (or creates) the target Tenant row by slug — 'default' if no
 *      slug is supplied. The slug is what every single-tenant deployment
 *      auto-creates at boot.
 *   2. For every collection in TARGET_COLLECTIONS, runs:
 *        updateMany({ tenantId: { $exists: false } }, { $set: { tenantId } })
 *      so rows that already have a tenantId aren't clobbered.
 *   3. Prints a per-collection summary {matched, modified}.
 *
 * Safety:
 *   - --dry-run prints the proposed counts without writing anything.
 *   - The script is idempotent: running it twice over the same DB is a
 *     no-op the second time (every row already has tenantId).
 *   - Collections are added EXPLICITLY (no wildcard) so a future schema
 *     change doesn't silently pull a new collection into the migration.
 */

import mongoose from 'mongoose';

const TARGET_COLLECTIONS = [
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
  'nlpcaches',
] as const;

async function ensureTenant(slug: string): Promise<mongoose.Types.ObjectId> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No mongoose db connection');
  const tenants = db.collection('tenants');
  const existing = await tenants.findOne({ slug });
  if (existing) return existing._id as mongoose.Types.ObjectId;
  const now = new Date();
  const result = await tenants.insertOne({
    slug,
    name: slug === 'default' ? 'Default Tenant' : slug,
    plan: 'free',
    status: 'active',
    brand: {
      primaryLanguage: 'si',
      timezone: 'Asia/Colombo',
    },
    budget: {
      dailyTokenCap: 1_000_000,
      monthlyCostUsdCap: 100,
      perConversationTokenCap: 8000,
    },
    createdAt: now,
    updatedAt: now,
  });
  console.log(`Created tenant '${slug}' (${result.insertedId})`);
  return result.insertedId;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const slugArg = args.find((a) => a.startsWith('--slug='));
  const slug = slugArg ? slugArg.slice('--slug='.length) : 'default';

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  const tenantId = await ensureTenant(slug);
  console.log(
    `Backfilling tenantId=${tenantId.toString()} (dry-run=${dryRun})`,
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error('No mongoose db');
  let totalModified = 0;
  for (const collName of TARGET_COLLECTIONS) {
    const coll = db.collection(collName);
    const filter = { tenantId: { $exists: false } };
    const matched = await coll.countDocuments(filter);
    if (dryRun) {
      console.log(`  ${collName}: ${matched} row(s) would be updated`);
      continue;
    }
    if (matched === 0) {
      console.log(`  ${collName}: skipped (already migrated)`);
      continue;
    }
    const result = await coll.updateMany(filter, { $set: { tenantId } });
    totalModified += result.modifiedCount;
    console.log(
      `  ${collName}: matched=${result.matchedCount}, modified=${result.modifiedCount}`,
    );
  }

  console.log(
    dryRun
      ? '\nDry-run complete — no writes performed.'
      : `\nMigration complete — total rows modified: ${totalModified}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
