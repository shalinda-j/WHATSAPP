/**
 * Dataset boot-time work — DATA INTEGRITY ONLY.
 *
 * This module used to ship two kinds of baked-in content:
 *   1. A 23-row "seeds" array that inserted empty placeholder Datasets
 *      (HELP_MESSAGE, JOBS_MESSAGE, AI_PERSONALITY, COMPANY_INFO, ...)
 *      whenever the database was missing them.
 *   2. A `migrateConfigDatasets()` pass that re-asserted `type:'config'`
 *      on any Dataset whose key matched a hardcoded allowlist of 23
 *      reserved key names.
 *
 * Both were removed in this commit on the operator's instruction: every
 * piece of Dataset content must now originate from MongoDB itself, not
 * from code. Fresh deployments start with an empty `datasets` collection;
 * operators populate it through the admin panel (Data Sets tabs / Config
 * tabs). Existing deployments are unaffected — the rows they already
 * have stay where they are.
 *
 * The one survivor is `cleanEmptyDatasetKeys()` because that's a data-
 * integrity migration, not a hardcoded seed. It only operates on the
 * shape of existing rows (`{ key: '' } → $unset key`) and inserts
 * nothing.
 */

import Dataset from '../models/Dataset';

/**
 * Migration: clear `key: ''` left behind by the old POST/PUT logic.
 *
 * The Dataset schema has `key: { unique: true, sparse: true }`. A sparse
 * unique index skips docs where the field is null/missing, but `''` is a
 * value — so every row written by the old route with `key: ''` shared
 * the same unique-index slot, and the second such insert was rejected
 * with E11000. That made user-created knowledge entries appear to save
 * once and then fail silently from the second onward.
 *
 * This migration is idempotent and only touches rows with `key === ''`.
 */
export const cleanEmptyDatasetKeys = async () => {
  try {
    const result = await Dataset.updateMany(
      { key: '' },
      { $unset: { key: '' } },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `🩹 Cleaned ${result.modifiedCount} Dataset row(s) with empty key:'' (so the sparse unique index ignores them).`,
      );
    }
  } catch (error) {
    console.error('❌ Error cleaning empty Dataset keys:', error);
  }
};

/**
 * Boot entry point. Kept as `seedDatasets` so the existing `index.ts`
 * boot sequence (`await seedDatasets()`) doesn't need an edit. The
 * function name is now a misnomer — it no longer seeds anything — but
 * preserving the name lets future maintainers grep for it.
 */
export const seedDatasets = async () => {
  await cleanEmptyDatasetKeys();
};
