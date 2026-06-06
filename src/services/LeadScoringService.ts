/**
 * LeadScoringService — a lightweight, always-on heuristic scorer that turns
 * raw inbound activity into a persisted multi-axis Lead.score so the funnel
 * can tell a hot, ready-to-enrol student from a cold browser.
 *
 * Pure heuristic (NO LLM call) → zero cost, zero latency on the hot path, and
 * fully fire-and-forget safe. The axes:
 *   fit        0–30  profile completeness (country / program / CV on file)
 *   intent     0–50  enrolment-intent language seen in messages + conversions
 *   engagement 0–20  how actively the person is messaging
 *   compound   0–100 sum, clamped → tier hot / warm / cold
 */
import Lead from '../models/Lead';

export type LeadTier = 'hot' | 'warm' | 'cold';

interface LeadScore {
  fit: number;
  intent: number;
  engagement: number;
  compound: number;
  tier: LeadTier;
  lastScoredAt?: Date;
}

const HOT_THRESHOLD = 70;
const WARM_THRESHOLD = 40;

// Enrolment-intent signals across English / Singlish / Sinhala.
const INTENT_TERMS = [
  'register',
  'enroll',
  'enrol',
  'admission',
  'apply',
  'join',
  'book',
  'visit',
  'fee',
  'fees',
  'cost',
  'price',
  'how much',
  'course',
  'courses',
  'program',
  'degree',
  'diploma',
  'intake',
  'scholarship',
  'register karanna',
  'enroll wenna',
  'ලියාපදිංචි',
  'පාඨමාලා',
  'ගාස්තු',
  'උපාධි',
];

function tierFor(compound: number): LeadTier {
  if (compound >= HOT_THRESHOLD) return 'hot';
  if (compound >= WARM_THRESHOLD) return 'warm';
  return 'cold';
}

function blankScore(): LeadScore {
  return { fit: 0, intent: 0, engagement: 0, compound: 0, tier: 'cold' };
}

class LeadScoringService {
  private recompute(score: LeadScore): LeadScore {
    score.compound = Math.min(
      100,
      (score.fit || 0) + (score.intent || 0) + (score.engagement || 0),
    );
    score.tier = tierFor(score.compound);
    score.lastScoredAt = new Date();
    return score;
  }

  /**
   * Bump engagement (+ intent when enrolment language is present) and refresh
   * the fit axis from the lead's known profile. Only scores KNOWN leads —
   * brand-new contacts get their first score when they register.
   */
  async scoreInbound(phoneNumber: string, messageText: string): Promise<void> {
    try {
      if (!phoneNumber) return;
      const lead: any = await Lead.findOne({ phoneNumber });
      if (!lead) return;

      const text = (messageText || '').toLowerCase();
      const intentHit = INTENT_TERMS.some((t) => text.includes(t));
      const score: LeadScore = lead.score || blankScore();

      score.engagement = Math.min(20, (score.engagement || 0) + 2);
      if (intentHit) score.intent = Math.min(50, (score.intent || 0) + 10);
      score.fit =
        (lead.interestedCountry ? 10 : 0) +
        (lead.jobVacancyType ? 10 : 0) +
        (lead.cvUrl ? 10 : 0);

      lead.score = this.recompute(score);
      await lead.save();
    } catch (err) {
      console.error('LeadScoringService.scoreInbound failed:', err);
    }
  }

  /** A conversion is the strongest possible intent signal — bump hard. */
  async onConversion(phoneNumber: string): Promise<void> {
    try {
      if (!phoneNumber) return;
      const lead: any = await Lead.findOne({ phoneNumber });
      if (!lead) return;
      const score: LeadScore = lead.score || blankScore();
      score.intent = Math.min(50, (score.intent || 0) + 25);
      score.fit =
        (lead.interestedCountry ? 10 : 0) +
        (lead.jobVacancyType ? 10 : 0) +
        (lead.cvUrl ? 10 : 0);
      lead.score = this.recompute(score);
      await lead.save();
    } catch (err) {
      console.error('LeadScoringService.onConversion failed:', err);
    }
  }
}

export const leadScoringService = new LeadScoringService();
export default leadScoringService;
