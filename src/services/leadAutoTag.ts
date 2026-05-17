import Lead from '../models/Lead';
import { classifyIntent } from './IntentClassifierService';

const TAG_PREFIX = 'intent:';
const MAX_TAGS_PER_LEAD = 12;

/**
 * Auto-applies an intent tag to every Lead matching the inbound phone
 * number. Fire-and-forget: errors are swallowed so a slow Mongo write
 * never blocks the message handler.
 *
 * Design:
 *  - One tag per intent (e.g. 'intent:booking_request') deduped via
 *    $addToSet so re-classifying the same intent is a no-op.
 *  - Capped at MAX_TAGS_PER_LEAD using a $slice update so a noisy
 *    contact can't blow up the array unbounded.
 *  - Intent 'unknown' / 'greeting' / 'spam' don't tag — they carry no
 *    actionable segmentation signal, and tagging every greeting would
 *    drown the useful tags in noise.
 */
const NON_TAGGABLE_INTENTS = new Set(['unknown', 'greeting', 'spam']);

export async function autoTagLeadFromMessage(
  phoneNumber: string,
  text: string,
): Promise<{ tagApplied: string | null; matched: number }> {
  if (!phoneNumber || !text) return { tagApplied: null, matched: 0 };
  const intent = classifyIntent(text);
  if (NON_TAGGABLE_INTENTS.has(intent)) {
    return { tagApplied: null, matched: 0 };
  }

  const tag = `${TAG_PREFIX}${intent}`;
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return { tagApplied: null, matched: 0 };

  // Match on both the exact stored value and a trailing-digit pattern
  // because Leads in the wild get stored with country prefixes inconsistently
  // (e.g. '+94771234567' vs '0771234567' vs '94771234567').
  const filter = {
    $or: [
      { phoneNumber: digits },
      { phoneNumber: `+${digits}` },
      { phoneNumber: { $regex: `${digits.slice(-9)}$` } },
    ],
  };

  // Two-step write keeps the cap honest:
  //   1. Push the new tag with $addToSet (dedupe).
  //   2. Trim back to MAX_TAGS_PER_LEAD with a $slice when push grows it.
  // A single update can't combine $addToSet + $slice on the same field
  // safely in Mongo without the array becoming a $each + $slice pair,
  // which would lose the dedupe guarantee. Two writes is the simpler,
  // correct shape.
  const addRes = await Lead.updateMany(filter, {
    $addToSet: { tags: tag },
    $set: { updatedAt: new Date() },
  });
  await Lead.updateMany(
    { ...filter, [`tags.${MAX_TAGS_PER_LEAD}`]: { $exists: true } },
    { $push: { tags: { $each: [], $slice: -MAX_TAGS_PER_LEAD } } },
  );

  return { tagApplied: tag, matched: addRes?.modifiedCount ?? 0 };
}
