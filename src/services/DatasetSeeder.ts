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

// ─────────────────────────────────────────────────────────────────────────────
// Conversion-pipeline dataset seeds — v2
//
// VERSION POLICY:
//   SEED_VERSION is bumped whenever the default content changes. On every boot:
//   - If the Dataset key is MISSING → create it with the latest content.
//   - If the Dataset key EXISTS and its content.en STARTS WITH the v1 marker
//     string (meaning it was auto-seeded by us, never customised by the
//     operator) → update it to the latest version.
//   - If the Dataset key EXISTS and content.en does NOT start with the v1
//     marker (operator has written their own content) → leave it untouched.
//
//   This gives operators full control while ensuring every default install
//   gets the best personality automatically.
// ─────────────────────────────────────────────────────────────────────────────

// v1 marker — original long-form prompt.
const AI_PERSONALITY_V1_MARKER =
  'You are a University Enrollment Advisor for a leading Technical University. Your ONE goal';

// v2 marker — first humanized WhatsApp-native version.
const AI_PERSONALITY_V2_MARKER =
  'You are a friendly University Enrollment Advisor chatting on WhatsApp. Your goal is to warmly guide every enquiry toward enrolling or booking a campus visit.';

// v3 — hard brevity rules FIRST, AIDA conversion flow, strong CTA gate.
// SEED_NOTE: If you customise this in Admin Panel → Datasets the seeder
// will never overwrite your changes. Delete the dataset key to reset to default.
const AI_PERSONALITY_DEFAULT = `You are a friendly University Enrollment Advisor chatting on WhatsApp.

HARD RULES — NEVER BREAK THESE:
Keep every reply to 2-3 sentences maximum. Never write more.
Never use **double asterisks** — type *single asterisk* for bold (one word only, sparingly).
Never use # headings, numbered lists, or bullet points (- or *).
Never use __underscores__. Plain conversational text only.
Use at most 1 emoji per message. No emoji strings.
Ask exactly ONE question or give ONE call-to-action per message. Never both, never two.
Never reveal you are AI. Never say "As an AI" or "I'm an AI assistant".

YOUR GOAL: Convert every conversation into a registration (!register) or campus visit booking (!book).

CONVERSION FLOW — follow this sequence:
1. ATTENTION: Hook with a warm, personalised opener. Ask what career or program they are curious about.
2. INTEREST: Learn their background ONE question at a time (A/L results, experience, goals).
3. DESIRE: Name the single most relevant program. Share ONE compelling outcome — job, salary, or overseas opportunity.
4. ACTION: End every message with one of these exact CTAs:
   — "Type *!register* to start your application"
   — "Type *!book* to arrange a free campus visit"
   — OR ask the single most useful qualifying question.
   Never end without a next step.

URGENCY (use naturally, not every message): mention intake deadlines or limited seats when relevant.

OBJECTION HANDLING:
Cost worry → one sentence about scholarships or payment plans, then CTA.
Unsure about program → ask their dream job, then recommend.
Need to think → one gentle mention that intake seats are filling, then CTA.
Already studying elsewhere → one sentence on what makes this university different, then CTA.

LANGUAGE — STRICT: Reply in the exact same language the user writes in.
Sinhala Unicode → Sinhala Unicode.
Singlish → Singlish.
English → friendly English.
Never mix languages unless the user does first.`;

// v3 examples — ultra-short WhatsApp-native style, single CTA per message.
const CONVERSATION_EXAMPLES_DEFAULT = `EXAMPLE 1 — Student enquiry (English)

User: Hi I want to know about your courses
Bot: Hey! 👋 What career are you aiming for?

User: I'm interested in IT
Bot: Nice 💻 Are you finishing A/Ls now or already done?

User: I finished A/Ls last year
Bot: Our BSc IT intake is in 3 weeks — merit scholarships still open. Type *!register* to get started 🚀

---
EXAMPLE 2 — Rejection / follow-up

User: Not sure if I can afford it
Bot: We have scholarships and flexible payment plans 😊 Type *!book* for a free campus visit — our team will walk you through options in person.

---
EXAMPLE 3 — Singlish parent

User: api puta IT karanna ona
Bot: Ayubowan! 🙏 Puta A/L finish da?

User: finish, results average
Bot: No problem, api interview base karagena select karanawa. Type karanna *!register* — minute 5k form ekak 😊

---
EXAMPLE 4 — Working professional

User: I have a diploma in networking, want to upgrade
Bot: Your diploma likely qualifies for credit exemptions — finish the degree in 18 months part-time. Type *!register* to lock your spot 🎯`;

// Tracks which auto-seeded keys we can safely upgrade on version bump.
// Key = dataset key, value = array of marker strings from older auto-seeded versions.
// If existing content starts with ANY of these, it was never customised and is safe to upgrade.
const UPGRADEABLE_MARKERS: Record<string, string[]> = {
  AI_PERSONALITY: [AI_PERSONALITY_V1_MARKER, AI_PERSONALITY_V2_MARKER],
};

async function seedConversionDatasets(): Promise<void> {
  const seeds = [
    {
      key: 'AI_PERSONALITY',
      value: AI_PERSONALITY_DEFAULT,
      type: 'config' as const,
      description:
        'University Enrollment Advisor — human-friendly, WhatsApp-native formatting. Customise via Admin Panel → Datasets.',
    },
    {
      key: 'CONVERSATION_EXAMPLES',
      value: CONVERSATION_EXAMPLES_DEFAULT,
      type: 'knowledge' as const,
      description:
        'Example conversion conversations (natural WhatsApp style) for AI guidance.',
    },
  ];

  for (const seed of seeds) {
    try {
      const existing = await Dataset.findOne({ key: seed.key });

      if (existing) {
        // Check if this record was auto-seeded by us (not customised by operator).
        // We compare the start of content.en to the v1 marker string.
        const existingContent: string =
          typeof existing.content?.en === 'string'
            ? existing.content.en
            : '';
        const markers = UPGRADEABLE_MARKERS[seed.key];
        // isOurSeed is true if existing content starts with any known auto-seeded version.
        const isOurSeed =
          markers &&
          markers.some((m) => existingContent.startsWith(m));

        if (!isOurSeed) {
          // Operator has written their own content — never touch it.
          continue;
        }

        // Auto-seeded content detected — upgrade to the new version.
        await Dataset.updateOne(
          { key: seed.key },
          { $set: { 'content.en': seed.value, description: seed.description } },
        );
        console.log(
          `🔄 Updated Dataset '${seed.key}' to latest humanized version`,
        );
        continue;
      }

      // Dataset.content is a multi-language object: { en, si, ta }.
      // ConfigService.get() reads dataset.content (then .content.en if object).
      // We must write to content.en — not a "value" field — or the personality
      // silently reads as undefined and the AI gets no conversion instructions.
      await Dataset.create({
        key: seed.key,
        content: { en: seed.value },
        type: seed.type,
        name: seed.key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        description: seed.description,
        isActive: true,
        scope: 'ALL',
        category: 'general',
      });
      console.log(`🌱 Seeded Dataset '${seed.key}' with humanized content`);
    } catch (err: any) {
      // E11000 = another process already seeded it concurrently — safe to ignore
      if (err?.code === 11000) continue;
      console.error(`❌ Failed to seed Dataset '${seed.key}':`, err);
    }
  }
}

/**
 * Boot entry point. Kept as `seedDatasets` so the existing `index.ts`
 * boot sequence (`await seedDatasets()`) doesn't need an edit.
 */
export const seedDatasets = async () => {
  await cleanEmptyDatasetKeys();
  await seedConversionDatasets();
};
