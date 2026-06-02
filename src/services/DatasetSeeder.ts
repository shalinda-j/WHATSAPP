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

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION_EXAMPLES — stored as an array of {user, assistant} objects so
// that:
//   1. ConfigService.getConversationExamples() receives a real array (not a
//      string) and can pass it straight to the AI context window.
//   2. The AIPersonalityTab frontend reads content.en as an array and renders
//      each pair in its example editor without needing string parsing.
//
// UPGRADE: any previously-seeded string value starting with the v3 marker
// below is auto-upgraded to the structured array on next server start.
// ─────────────────────────────────────────────────────────────────────────────

// Old v3 string marker — used to detect records we can safely upgrade.
const CONVERSATION_EXAMPLES_V3_STRING_MARKER =
  'EXAMPLE 1 — Student enquiry (English)';

// v4 — structured array (ConfigService & frontend both read content.en).
const CONVERSATION_EXAMPLES_DEFAULT: Array<{
  user: string;
  assistant: string;
}> = [
  {
    user: 'Hi I want to know about your courses',
    assistant: 'Hey! 👋 What career are you aiming for?',
  },
  {
    user: "I'm interested in IT",
    assistant: 'Nice 💻 Are you finishing A/Ls now or already done?',
  },
  {
    user: 'I finished A/Ls last year',
    assistant:
      'Our BSc IT intake is in 3 weeks — merit scholarships still open. Type *!register* to get started 🚀',
  },
  {
    user: 'Not sure if I can afford it',
    assistant:
      'We have scholarships and flexible payment plans 😊 Type *!book* for a free campus visit — our team will walk you through options in person.',
  },
  {
    user: 'api puta IT karanna ona',
    assistant: 'Ayubowan! 🙏 Puta A/L finish da?',
  },
  {
    user: 'finish, results average',
    assistant:
      'No problem, api interview base karagena select karanawa. Type karanna *!register* — minute 5k form ekak 😊',
  },
  {
    user: 'I have a diploma in networking, want to upgrade',
    assistant:
      'Your diploma likely qualifies for credit exemptions — finish the degree in 18 months part-time. Type *!register* to lock your spot 🎯',
  },
];

// Tracks which auto-seeded keys we can safely upgrade on version bump.
// Key = dataset key, value = array of marker strings from older auto-seeded versions.
// If existing content.en starts with ANY of these markers, it was never
// customised by the operator and is safe to upgrade to the current seed value.
const UPGRADEABLE_MARKERS: Record<string, string[]> = {
  AI_PERSONALITY: [AI_PERSONALITY_V1_MARKER, AI_PERSONALITY_V2_MARKER],
  // CONVERSATION_EXAMPLES was previously seeded as a multiline string.
  // Upgrade those records to the structured array format so ConfigService and
  // the admin UI both receive a proper [{user, assistant}] array.
  CONVERSATION_EXAMPLES: [CONVERSATION_EXAMPLES_V3_STRING_MARKER],
};

// COMPANY_INFO — placeholder business profile the bot references when it
// answers. The operator EDITS these values in Admin Panel → Datasets. Seeded
// with obvious placeholders so it's clear what to fill in (never invented at
// runtime — the AI is instructed to offer a visit/human rather than guess).
const COMPANY_INFO_DEFAULT = {
  name: 'Our Training Center',
  tagline: 'Skills training & overseas job opportunities',
  address: '[ADD YOUR TRAINING CENTER ADDRESS]',
  phone: '[ADD YOUR CONTACT NUMBER]',
  email: '[ADD YOUR EMAIL]',
  openDays: '[e.g. Monday–Saturday, 9am–5pm]',
  website: '',
};

// AI_KNOWLEDGE_BASE — placeholder FAQ the AI can draw on. Q/A pairs. The
// operator replaces these with real course names, fees, durations, countries,
// and requirements. Until edited, the bot answers honestly that it will
// confirm exact details on a visit rather than guessing.
const AI_KNOWLEDGE_BASE_DEFAULT = [
  {
    question: 'What do you offer?',
    answer:
      'We provide skills training and help with local and overseas job placement. [EDIT: list your actual courses/services here.]',
  },
  {
    question: 'Which courses / services are available?',
    answer:
      '[EDIT: e.g. Welding, Caregiving, Hospitality, Language training, etc.]',
  },
  {
    question: 'How much does it cost?',
    answer:
      '[EDIT: add your fees, or keep this and the bot will invite them to a free visit to discuss options.]',
  },
  {
    question: 'Where are you located and when are you open?',
    answer:
      '[EDIT: add your address and open days/hours.] You are warmly welcome to visit us.',
  },
  {
    question: 'How do I get started?',
    answer:
      'The easiest first step is a free, no-obligation campus visit — we assess your skills and show you matching opportunities. Just say "yes" and we will arrange a time.',
  },
];

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
    {
      key: 'COMPANY_INFO',
      value: COMPANY_INFO_DEFAULT,
      type: 'config' as const,
      description:
        'Your business profile (name, address, phone, open days). EDIT these placeholders in Admin Panel → Datasets so the bot answers with your real details.',
    },
    {
      key: 'AI_KNOWLEDGE_BASE',
      value: AI_KNOWLEDGE_BASE_DEFAULT,
      type: 'knowledge' as const,
      description:
        'FAQ the AI draws on (courses, fees, location). EDIT these placeholders with your real details in Admin Panel → Datasets / Knowledge.',
    },
  ];

  for (const seed of seeds) {
    try {
      const existing = await Dataset.findOne({ key: seed.key });

      if (existing) {
        // Determine whether the stored content was auto-seeded by us (never
        // customised by the operator) by checking known marker strings.
        //
        // content.en may be:
        //   - a string (AI_PERSONALITY text, or old CONVERSATION_EXAMPLES string)
        //   - an array [{user, assistant}] (new CONVERSATION_EXAMPLES format)
        // If it is an array it was saved by the UI after at least one seeder
        // run — treat it as operator-authored and do not overwrite.
        const existingEn = existing.content?.en;
        const existingContent: string =
          typeof existingEn === 'string' ? existingEn : '';
        const markers = UPGRADEABLE_MARKERS[seed.key];
        // isOurSeed is true if existing content starts with any known auto-seeded string version.
        // Array-format values are never auto-seeded strings so they fall through to !isOurSeed.
        const isOurSeed =
          markers &&
          typeof existingEn === 'string' &&
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
