/**
 * One-time maintenance: backfill the real phone number on CRM Contacts that
 * were auto-created from `@lid` WhatsApp chats and therefore have NO dialable
 * phone on file.
 *
 * Background:
 *   WhatsApp's privacy "Linked-ID" rollout means many inbound conversations
 *   arrive as opaque `<digits>@lid` identifiers instead of phone-backed JIDs.
 *   Contacts auto-created from those chats land in the CRM with an empty
 *   `phone` (correct — a LID is NOT a phone, see src/utils/jid.ts). Once the
 *   bot later learns the real number (vCard share, Baileys senderPn,
 *   onWhatsApp reverse lookup) it stores the link in the `LidPhoneMapping`
 *   collection — but the already-created Contact row is never re-stamped, so
 *   CRM/exports keep showing "no number" for someone we can now actually dial.
 *
 *   This script walks those phone-less LID Contacts and, when a real phone is
 *   known in LidPhoneMapping, writes:
 *       phone          = "+<digits>"            (dialable, E.164-ish)
 *       whatsappNumber = "<digits>"
 *       whatsappId     = "<digits>@s.whatsapp.net"
 *
 * USAGE:
 *   # 1. Preview — logs what WOULD change, writes nothing:
 *   npx ts-node src/scripts/backfill-contact-phones.ts --dry-run
 *
 *   # 2. Apply for real:
 *   npx ts-node src/scripts/backfill-contact-phones.ts
 *
 * Safety:
 *   - --dry-run performs ZERO writes.
 *   - Contacts are updated one at a time with `updateOne` (never a bulk
 *     overwrite) so a single bad row can't corrupt the batch.
 *   - Only phone-less LID contacts are touched; rows that already have a
 *     phone are skipped, making the script idempotent (a second run is a
 *     no-op for already-fixed contacts).
 *   - The script connects, runs, disconnects, and exits cleanly.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import { Contact } from '../models/CRM';
import {
  loadPhoneMapForLids,
  normaliseLidJid,
} from '../services/LidPhoneMappingService';

interface ContactRow {
  _id: mongoose.Types.ObjectId;
  sessionId?: string;
  name?: string;
  phone?: string | null;
  whatsappId?: string | null;
  whatsappNumber?: string | null;
  // Stored as a Mongoose Map; `.lean()` returns it as a plain object.
  customFields?: Record<string, string> | null;
}

/**
 * Pull the best @lid identifier we have for a contact, preferring the raw
 * JID we stamped at creation time, then falling back to the WhatsApp id
 * fields. `normaliseLidJid` returns null for anything that isn't a LID.
 */
function resolveLidJid(row: ContactRow): string | null {
  const cf = row.customFields ?? {};
  const candidates = [
    cf.rawWhatsappJid,
    cf.lid,
    row.whatsappId,
    row.whatsappNumber,
  ];
  for (const candidate of candidates) {
    const lid = normaliseLidJid(candidate);
    if (lid) return lid;
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );
  console.log(`Backfilling LID contact phones (dry-run=${dryRun})`);

  // Phone-less AND flagged as a LID contact (either explicit identifierType
  // marker or a rawWhatsappJid that ends in @lid).
  const filter = {
    $and: [
      {
        $or: [
          { phone: { $exists: false } },
          { phone: null },
          { phone: '' },
        ],
      },
      {
        $or: [
          { 'customFields.identifierType': 'lid' },
          { 'customFields.rawWhatsappJid': /@lid$/ },
        ],
      },
    ],
  };

  const contacts = (await Contact.find(filter).lean()) as ContactRow[];

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let skippedNoLid = 0;
  let skippedNoMapping = 0;

  for (const row of contacts) {
    scanned += 1;

    const lidJid = resolveLidJid(row);
    if (!lidJid) {
      skippedNoLid += 1;
      continue;
    }

    // loadPhoneMapForLids normalises internally and honours session scope
    // (with an $exists fallback for cross-session mappings).
    const phoneMap = await loadPhoneMapForLids([lidJid], row.sessionId);
    const digits = phoneMap.get(lidJid);
    if (!digits) {
      skippedNoMapping += 1;
      continue;
    }

    matched += 1;

    const phone = `+${digits}`;
    const whatsappNumber = digits;
    const whatsappId = `${digits}@s.whatsapp.net`;
    const label = row.name ? `"${row.name}"` : '(unnamed)';

    if (dryRun) {
      console.log(
        `  WOULD update ${String(row._id)} ${label}: ${lidJid} -> phone=${phone}`,
      );
      continue;
    }

    try {
      // One contact at a time — never a bulk overwrite.
      await Contact.updateOne(
        { _id: row._id },
        {
          $set: {
            phone,
            whatsappNumber,
            whatsappId,
            updatedAt: new Date(),
          },
        },
      );
      updated += 1;
      console.log(`  updated ${String(row._id)} ${label}: ${phone}`);
    } catch (err) {
      // Per-row failure must not halt the batch.
      console.error(`  FAILED ${String(row._id)} ${label}:`, err);
    }
  }

  console.log('\nSummary:');
  console.log(`  scanned (phone-less LID contacts): ${scanned}`);
  console.log(`  matched (real phone found):        ${matched}`);
  console.log(`  updated (rows written):            ${dryRun ? 0 : updated}`);
  console.log(`  skipped — no usable @lid:          ${skippedNoLid}`);
  console.log(`  skipped — no mapping yet:          ${skippedNoMapping}`);
  console.log(
    dryRun
      ? '\nDry-run complete — no writes performed.'
      : '\nBackfill complete.',
  );

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
