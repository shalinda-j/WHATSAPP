/**
 * Destructive one-shot — permanently wipes user-visible data from the
 * admin "Data Sets" tabs.
 *
 *   USAGE:
 *     # Dry-run (safe, READ-ONLY — prints counts of what WOULD be deleted)
 *     npx ts-node scripts/wipe_datasets.ts
 *
 *     # Actually delete. Type the confirmation string EXACTLY.
 *     npx ts-node scripts/wipe_datasets.ts --execute --confirm=YES-WIPE-ALL-DATA
 *
 *   WHAT IT DELETES:
 *     1. Dataset rows where type ≠ 'config'   (Knowledge / Commands / Links /
 *                                              Mega Text / Personality /
 *                                              Acknowledgements tabs)
 *     2. KnowledgeEntry rows                  (auto-learned Q/A)
 *     3. AgentSkill rows                      (per-tenant prompt sections)
 *     4. FormTemplate rows                    (forms defined in Form Builder)
 *     5. FormSubmission rows                  (customer responses to those forms)
 *
 *   WHAT IT PRESERVES (intentional):
 *     - Dataset rows with type='config' — internal runtime config
 *       (HELP_MESSAGE, AI_PERSONALITY, JOBS_MESSAGE, COMPANY_INFO, etc.).
 *       Removing these would brick the bot until the operator
 *       re-configures every key by hand in Admin Panel > Settings.
 *     - ChatMessage / Lead / Contact / Booking / Session collections —
 *       these are NOT in the Data Sets tabs and the operator did not ask
 *       to wipe them. CRM data stays untouched.
 *     - LidPhoneMapping — the LID→phone resolution table is independent
 *       data; wiping it would re-introduce "Unknown contact" rows in
 *       the chat list.
 *
 *   SAFETY:
 *     - Default behaviour is dry-run. You must pass BOTH --execute AND
 *       --confirm=YES-WIPE-ALL-DATA. The two-step gate is intentional —
 *       a stray `--execute` alone won't fire.
 *     - Prints a summary BEFORE deletion so you can sanity-check counts.
 *     - Per-collection delete; one failure doesn't halt the rest, but
 *       the script exits with non-zero so CI/operator notice.
 *
 *   IRREVERSIBLE — backup the Mongo database first if you have any doubt.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

interface CollectionPlan {
  collection: string;
  label: string;
  // Filter applied to the .deleteMany call. Empty {} = wipe everything.
  filter: Record<string, unknown>;
}

const PLAN: CollectionPlan[] = [
  {
    collection: 'datasets',
    label:
      'Datasets (Knowledge / Commands / Links / Mega Text / Personality / Acknowledgements)',
    filter: { type: { $ne: 'config' } },
  },
  {
    collection: 'knowledgeentries',
    label: 'Auto-learned KnowledgeEntry rows',
    filter: {},
  },
  {
    collection: 'agentskills',
    label: 'Agent Skills',
    filter: {},
  },
  {
    collection: 'formtemplates',
    label: 'Form Templates',
    filter: {},
  },
  {
    collection: 'formsubmissions',
    label: 'Form Submissions (customer responses)',
    filter: {},
  },
];

const REQUIRED_CONFIRMATION = 'YES-WIPE-ALL-DATA';

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const confirmArg = args.find((a) => a.startsWith('--confirm='));
  const confirm = confirmArg ? confirmArg.slice('--confirm='.length) : '';

  if (execute && confirm !== REQUIRED_CONFIRMATION) {
    console.error(
      `❌ Refusing to execute. Pass --confirm=${REQUIRED_CONFIRMATION} when you mean it.`,
    );
    process.exit(2);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const dbName = mongoose.connection.db?.databaseName ?? '(unknown)';
  const mode = execute ? '⚠️  LIVE EXECUTE' : '🔍 DRY-RUN';
  console.log(`\n${mode} — database: ${dbName}\n`);

  let totalMatched = 0;
  let totalDeleted = 0;
  const errors: Array<{ collection: string; error: unknown }> = [];

  for (const item of PLAN) {
    const coll = mongoose.connection.db!.collection(item.collection);

    let matched = 0;
    try {
      matched = await coll.countDocuments(item.filter);
    } catch (err) {
      console.error(`   ❌ ${item.collection}: count failed:`, err);
      errors.push({ collection: item.collection, error: err });
      continue;
    }

    if (matched === 0) {
      console.log(
        `   ✓ ${item.label}\n     [${item.collection}] already empty`,
      );
      continue;
    }

    if (!execute) {
      console.log(
        `   ⚠️  ${item.label}\n     [${item.collection}] would delete ${matched} row(s)`,
      );
      totalMatched += matched;
      continue;
    }

    try {
      const result = await coll.deleteMany(item.filter);
      const deleted = result.deletedCount ?? 0;
      totalDeleted += deleted;
      totalMatched += matched;
      console.log(
        `   🗑️  ${item.label}\n     [${item.collection}] matched=${matched}, deleted=${deleted}`,
      );
    } catch (err) {
      console.error(
        `   ❌ ${item.collection}: delete failed (${matched} were matched):`,
        err,
      );
      errors.push({ collection: item.collection, error: err });
    }
  }

  console.log('');
  if (execute) {
    console.log(
      `✅ Done. matched=${totalMatched}, deleted=${totalDeleted}` +
        (errors.length > 0 ? `, errors=${errors.length}` : ''),
    );
    // Remind the operator about the config placeholders surviving — they
    // would otherwise wonder why the Datasets list isn't completely empty
    // after the wipe.
    console.log(
      `\nℹ️  Dataset rows with type='config' (HELP_MESSAGE, AI_PERSONALITY,\n   JOBS_MESSAGE, COMPANY_INFO, etc.) were preserved on purpose —\n   they are internal runtime config, not user-visible content.\n   They never appear in the Data Sets tabs.`,
    );
  } else {
    console.log(
      `📋 Dry-run complete — no changes written. ${totalMatched} row(s) would have been deleted.`,
    );
    console.log(
      `\nTo execute for real, run:\n   npx ts-node scripts/wipe_datasets.ts --execute --confirm=${REQUIRED_CONFIRMATION}`,
    );
  }

  await mongoose.disconnect();
  if (errors.length > 0) process.exit(3);
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
