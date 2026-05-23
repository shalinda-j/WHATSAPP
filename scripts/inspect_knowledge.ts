/**
 * Read-only diagnostic for the "previous data not showing in Datasets page" issue.
 *
 * Counts and samples documents in every collection that participates in the
 * knowledge / forms surface:
 *   - datasets         (Dataset model, shown in /datasets Knowledge tab)
 *   - knowledgeentries (KnowledgeEntry model, written by auto-learning,
 *                       NOT shown in /datasets today — the bug we're fixing)
 *   - formtemplates    (FormTemplate, shown in /form-builder, NOT in /datasets)
 *   - formsubmissions  (FormSubmission)
 *
 * Run with:
 *   npx ts-node-dev --respawn=false scripts/inspect_knowledge.ts
 * or:
 *   npx ts-node scripts/inspect_knowledge.ts
 *
 * Requires MONGODB_URI in your .env. The script makes no writes.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  const dbName = mongoose.connection.db?.databaseName ?? '(unknown)';
  console.log(`✅ Connected to MongoDB → database: ${dbName}\n`);

  const targets = [
    { collection: 'datasets', label: 'Dataset (Knowledge tab source)' },
    {
      collection: 'knowledgeentries',
      label: 'KnowledgeEntry (auto-learning store)',
    },
    { collection: 'formtemplates', label: 'FormTemplate' },
    { collection: 'formsubmissions', label: 'FormSubmission' },
  ];

  for (const t of targets) {
    const coll = mongoose.connection.db!.collection(t.collection);
    const total = await coll.countDocuments();
    console.log(`\n── ${t.label}  (collection: ${t.collection}) ──`);
    console.log(`   total documents: ${total}`);

    if (total === 0) continue;

    if (t.collection === 'datasets') {
      const byType = await coll
        .aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }])
        .toArray();
      console.log('   by type:');
      for (const row of byType) {
        console.log(`     ${row._id ?? '(null/missing)'}: ${row.n}`);
      }
    }

    if (t.collection === 'knowledgeentries') {
      const bySource = await coll
        .aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }])
        .toArray();
      console.log('   by source:');
      for (const row of bySource) {
        console.log(`     ${row._id ?? '(missing)'}: ${row.n}`);
      }
      const byLanguage = await coll
        .aggregate([{ $group: { _id: '$language', n: { $sum: 1 } } }])
        .toArray();
      console.log('   by language:');
      for (const row of byLanguage) {
        console.log(`     ${row._id ?? '(missing)'}: ${row.n}`);
      }
      const active = await coll.countDocuments({ isActive: true });
      console.log(`   isActive:true count: ${active}`);
    }

    const sample = await coll.find({}).limit(3).toArray();
    console.log('   sample (first 3):');
    for (const doc of sample) {
      const preview = JSON.stringify(doc, null, 2)
        .split('\n')
        .map((l) => '     ' + l)
        .join('\n');
      console.log(preview);
      console.log('     ---');
    }
  }

  await mongoose.disconnect();
  console.log('\n✅ Done — no writes performed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
