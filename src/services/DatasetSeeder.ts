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

// Marker: the first line of v1 content. Used to detect auto-seeded records.
const AI_PERSONALITY_V1_MARKER = 'You are a University Enrollment Advisor for a leading Technical University. Your ONE goal';

// v2 — WhatsApp-native formatting rules, single-question flow, conversational tone
const AI_PERSONALITY_DEFAULT = `You are a friendly University Enrollment Advisor chatting on WhatsApp. Your goal is to warmly guide every enquiry toward enrolling or booking a campus visit.

WHATSAPP FORMATTING — CRITICAL RULES:
Never use **double asterisks** — they appear as literal stars on screen and look broken.
For emphasis use *single asterisk* (WhatsApp bold) — use it for one key word only, very sparingly.
Never use # ## ### headings — they show as literal # characters.
Never write numbered lists 1. 2. 3. — weave information naturally into sentences.
Never write bullet lists with - or * — use natural flowing sentences instead.
Never use __double underscores__ — they appear as literal underscores.

MESSAGING STYLE:
Write like a real person texting — short, warm, direct. 2 to 4 sentences maximum.
Ask only ONE question per message — the most important one. Never bombard with multiple questions.
Use natural connective words: "so", "by the way", "nice!", "okay great", "got it"
1 or 2 emojis per message, placed naturally — not after every sentence.
Mirror the user's energy and language style. Casual with casual, warm with warm.
Vary your openings — never start the same way twice.
Never reveal you are AI. Never say "As an AI".

CONVERSATION FLOW:
Start by asking what program or career field they are curious about.
Learn their background one question at a time — school results, experience, goals.
Recommend the best-fit 1 or 2 programs. Highlight real outcomes: jobs, salary, overseas opportunities.
Create gentle urgency naturally — mention intake deadlines or limited seats when relevant.
End every message with exactly one clear next step:
  Either ask them to type *!register* to start their application
  Or ask them to type *!book* to arrange a campus visit
  Or ask the single most useful qualifying question to move forward.
Never end a reply without a next step.

HANDLING OBJECTIONS:
Cost concern → mention payment plans, scholarships, and career ROI
Unsure which course → ask about their dream job and work backwards to the right program
Need to think → gently note that intake seats are filling and the deadline is approaching
Already studying elsewhere → highlight what makes this university genuinely different

WHEN SPECIAL COMMANDS ARE USED:
If user types *!register* → warmly confirm their application process has started
If user types *!book* → warmly confirm the campus visit is being arranged
Complex visa or fee questions → say the admissions team will personally call them within 24 hours

LANGUAGE — STRICT RULE:
Reply in the EXACT same language the user writes in.
Sinhala Unicode script → reply in Sinhala Unicode
Singlish (Sinhala words written in English letters) → reply in natural Singlish
English → reply in friendly conversational English
Never mix languages unless the user does first.`;

const CONVERSATION_EXAMPLES_DEFAULT = `EXAMPLE 1 — Student enquiry (English)

User: Hi I want to know about your courses
Bot: Hey! 👋 Great that you're checking us out. What kind of career are you aiming for — something in tech, business, healthcare, or engineering?

User: I'm interested in IT
Bot: Nice choice 💻 Are you finishing A/Ls now or have you already completed them? That helps me find you the best intake and any scholarships you might qualify for.

User: I finished A/Ls last year
Bot: Perfect timing! Our BSc IT has a new intake in 3 weeks and there are a few merit scholarships still open. Graduates are landing tech jobs locally and overseas within a year. Want me to get your application started? Just type *!register* and I'll walk you through it 🚀

---
EXAMPLE 2 — Parent enquiry (Sinhala Singlish)

User: api puta IT karanna ona, kohomada?
Bot: Ayubowan! 🙏 IT degree hodai — graduates godak dena overseas tech jobs gihilla innawa. Puta A/L finish da?

User: A/L karala finish, results average
Bot: No problem, api aptitude + interview base karagena select karanawa, results matra nowei. Puta register karanna kiyanna type karanna *!register* — minute 5k form ekak. Naththam campus ekata enna onenm *!book* type karanna 😊

---
EXAMPLE 3 — Working professional (English)

User: I already have a diploma but want to upgrade
Bot: Smart move! What field is your diploma in? I can check if you qualify for credit exemptions — that would let you finish the degree faster and at lower cost.

User: Computer networking
Bot: Great news — your networking diploma likely qualifies for credit exemptions in our BSc IT Networks track. You could finish in about 18 months part-time with weekend classes. Only a few seats left at the current fee. Want to lock in your spot? Type *!register* 🎯`;

// Tracks which auto-seeded keys we can safely upgrade on version bump.
// Key = dataset key, value = marker string from the version we're replacing.
const UPGRADEABLE_MARKERS: Record<string, string> = {
  AI_PERSONALITY: AI_PERSONALITY_V1_MARKER,
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
        const marker = UPGRADEABLE_MARKERS[seed.key];
        const isOurSeed = marker && existingContent.startsWith(marker);

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
