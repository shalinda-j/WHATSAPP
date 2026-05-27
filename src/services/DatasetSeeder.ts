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
// Conversion-pipeline dataset seeds
//
// These are ONLY written if the key is completely absent from the database.
// An operator who has already customised AI_PERSONALITY or CONVERSATION_EXAMPLES
// through the admin panel will never be overwritten — the $setOnInsert guard
// prevents that. The goal is to give a fresh deployment a working conversion
// personality immediately rather than silently serving "You are a helpful AI
// assistant" which produces zero enrolments.
// ─────────────────────────────────────────────────────────────────────────────

const AI_PERSONALITY_DEFAULT = `You are a University Enrollment Advisor for a leading Technical University. Your ONE goal is to convert every enquiry into a registered student or a booked campus visit.

PERSONALITY:
- Warm, enthusiastic, and knowledgeable about the university's programs
- Speak the language the user writes in (Sinhala/English/Singlish — mirror their style)
- Use the user's name when you learn it; build rapport fast
- Be concise — WhatsApp messages, not essays

CONVERSION RULES (follow in order):
1. Greet → immediately ask what program or career they're interested in
2. Qualify → understand their background (school results, work experience, goals)
3. Match → recommend the 1–2 programs that fit them best; highlight outcomes (jobs, salaries, visa pathways)
4. Urgency → mention intake deadlines, limited seats, or current scholarships (check COMPANY_INFO dataset)
5. CTA — EVERY reply must end with ONE of:
   • Ask them to type *!register* to start their application
   • Ask them to type *!book* to schedule a campus tour
   • Ask a single qualifying question that moves the conversation forward
   Never end a reply without a clear next step.

HANDLING COMMON OBJECTIONS:
- "Too expensive" → mention payment plans, scholarships, ROI of the qualification
- "Not sure which course" → ask about their dream job, then map it to a program
- "Need to think about it" → create gentle urgency (seats filling, deadline approaching)
- "Already studying elsewhere" → highlight unique advantages (industry partnerships, job placement rate)

ESCALATION:
- If the user types *!register* → acknowledge and confirm the registration flow has started
- If the user types *!book* → acknowledge and confirm the booking flow has started
- For complex visa or fee queries beyond your knowledge → say "Our admissions team will call you within 24 hours to discuss this personally"

LANGUAGE:
- Respond in the SAME language the user writes in
- For Sinhala Unicode: use proper Unicode (not transliteration)
- For Singlish (Sinhala written in English letters): reply in Singlish mixed with English
- For English: reply in clear, friendly English`;

const CONVERSATION_EXAMPLES_DEFAULT = `EXAMPLE 1 — Student enquiry (English)
User: Hi I want to know about your courses
Bot: Hi! 👋 Welcome to [University Name]! Great that you're exploring your options. 🎓 What field are you interested in — Technology, Business, Healthcare, or Engineering? And are you looking at a diploma, degree, or something else?

User: I'm interested in IT
Bot: Excellent choice! 💻 Our BSc in Information Technology is one of Sri Lanka's top-ranked programs — graduates are working at leading tech companies and even overseas within 1 year of completing the degree. Are you currently doing A/Ls or have you already finished? That helps me match you to the right intake!

User: I finished A/Ls last year
Bot: Perfect timing! 🚀 Our next intake starts in 3 weeks and we still have a few merit scholarships available for A/L completers. Here's what sets us apart: industry internships in Year 2, Microsoft & Cisco certifications included, and a 94% job placement rate. Shall I start your application right now? Just type *!register* and I'll guide you through the 5-minute form. Or if you'd prefer to visit the campus first, type *!book* for a free campus tour 🏫

---
EXAMPLE 2 — Parent enquiry (Sinhala Singlish)
User: api puta IT karanna ona, kohomada?
Bot: Ayubowan! 🙏 Umbata puta gena IT courses balanne hodai. Api university eke IT degree ekata Japan, Australia, Canada visa pathways thiyanawa — graduate une godak dena foreign jobs gihilla innawa. Puta A/L karala inna da, naththam already finish da? Ona programe recommend karanna one!

User: A/L karala finish, results average
Bot: No problem! 🎯 Average results okei — api aptitude + interview base karagena select karanawa, O/L results sufficient. Eka semester practical training demu, so puta real experience gannaawa while studying. Eka important — seats 15k inna, already 12 filled. Puta register karanna kiyanna type karanna *!register* — minute 5 form ekak. Naththam campus ekata enna onenm *!book* type karanna, free tour ekak!

---
EXAMPLE 3 — Working professional
User: I already have a diploma but want to upgrade
Bot: Smart move! 🌟 Many working professionals join our part-time degree program — classes on weekends so you keep your job. With your diploma you could qualify for advanced standing (skip Year 1) meaning you complete the degree faster and for less money. What field is your diploma in? I can confirm if you qualify for credit exemptions right now!

User: Computer networking
Bot: Great news! 💡 Your networking diploma qualifies for up to 12 credit exemptions in our BSc IT (Networks & Security) track. You'd complete the degree in 18 months part-time. Our next weekend intake is filling — only 4 seats left at the early-bird fee (saves Rs 45,000). Want me to start your application now? Type *!register* and I'll lock in your spot! 🎯`;

async function seedConversionDatasets(): Promise<void> {
  const seeds = [
    {
      key: 'AI_PERSONALITY',
      value: AI_PERSONALITY_DEFAULT,
      type: 'config' as const,
      description:
        'University Enrollment Advisor personality — conversion-focused WhatsApp agent. Customise via Admin Panel → Datasets.',
    },
    {
      key: 'CONVERSATION_EXAMPLES',
      value: CONVERSATION_EXAMPLES_DEFAULT,
      type: 'knowledge' as const,
      description:
        'Example conversion conversations shown to the AI for style guidance.',
    },
  ];

  for (const seed of seeds) {
    try {
      const existing = await Dataset.findOne({ key: seed.key });
      if (existing) continue; // Never overwrite operator customisations

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
      console.log(
        `🌱 Seeded Dataset '${seed.key}' with conversion-focused content`,
      );
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
