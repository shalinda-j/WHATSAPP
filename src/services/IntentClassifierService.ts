import { Intent } from '../types/agent';

interface IntentRule {
  intent: Intent;
  // Each rule is an array of keywords; matching ANY keyword scores +1.
  // We pick the intent with the highest score above the floor.
  keywords: string[];
}

// Fast, deterministic, multilingual keyword classifier. Sub-millisecond,
// zero LLM cost. Intentionally heuristic — LLM-based classification can be
// swapped in later behind the same classifyIntent() API. Production agents
// should treat intent as a HINT, not ground truth.
const RULES: IntentRule[] = [
  {
    intent: 'greeting',
    keywords: [
      'hi',
      'hello',
      'hey',
      'halo',
      'good morning',
      'good evening',
      'ayubowan',
      'ayubvan',
      'aaubowan',
      'vandanai',
      'vanakkam',
      'namaste',
      'namaskar',
      'kohomada',
      'kohomda',
    ],
  },
  {
    intent: 'booking_request',
    keywords: [
      'book',
      'booking',
      'schedule',
      'appointment',
      'interview',
      'slot',
      'slots',
      'available',
      'availability',
      'meet',
      'meeting',
      'arrange a call',
      'call me',
      'visit',
      'kalanaya',
      'kawadada',
      'velaawa',
      'velaa',
      'samaagama',
    ],
  },
  {
    intent: 'lead_inquiry',
    keywords: [
      'job',
      'jobs',
      'vacancy',
      'vacancies',
      'apply',
      'opportunity',
      'work abroad',
      'overseas',
      'rakiya',
      'rakeeya',
      'rakiyak',
      'welada',
      'wedek',
      'wadak',
      'wada',
      'rassawak',
      'rassawa',
    ],
  },
  {
    intent: 'job_search',
    keywords: [
      'welding',
      'caregiver',
      'caretaker',
      'factory',
      'construction',
      'hotel',
      'restaurant',
      'driver',
      'helper',
      'cleaner',
      'nursing',
      'japan',
      'korea',
      'qatar',
      'dubai',
      'saudi',
      'oman',
      'kuwait',
    ],
  },
  {
    intent: 'pricing_question',
    keywords: [
      'price',
      'cost',
      'fee',
      'fees',
      'charge',
      'how much',
      'kiyada',
      'gana',
      'salli',
      'mudal',
      'salary',
      'pay',
    ],
  },
  {
    intent: 'support_request',
    keywords: [
      'help',
      'support',
      'problem',
      'issue',
      'error',
      'cant',
      "can't",
      'cannot',
      'not working',
      'help karanna',
      'udauwwa',
      'udau',
    ],
  },
  {
    intent: 'complaint',
    keywords: [
      'complain',
      'complaint',
      'angry',
      'frustrated',
      'refund',
      'scam',
      'fraud',
      'fake',
      'wrong',
      'naraka',
      'narakai',
      'narak',
    ],
  },
  {
    intent: 'feedback',
    keywords: [
      'feedback',
      'review',
      'thanks',
      'thank you',
      'great',
      'awesome',
      'bohoma stuti',
      'stuti',
      'shukriya',
      'romba nandri',
    ],
  },
  {
    intent: 'spam',
    keywords: [
      'click here',
      'free money',
      'bitcoin',
      'crypto',
      'casino',
      'http://',
      'https://t.me/',
      'http://t.me/',
    ],
  },
];

const MIN_SCORE = 1;

/**
 * Match a keyword against the message. A plain substring match made short
 * tokens fire inside unrelated words — 'hi' matched 'this', 'hey' matched
 * 'they', 'no' matched 'know' — so "is this available?" was misclassified as a
 * greeting. Single alphanumeric-word keywords are therefore matched on word
 * boundaries; phrases / URLs / punctuated keywords (which contain non-word
 * characters and can't false-positive this way) keep the substring match.
 */
function keywordMatches(haystack: string, keyword: string): boolean {
  if (/[^a-z0-9]/i.test(keyword)) {
    return haystack.includes(keyword);
  }
  return new RegExp(`\\b${keyword}\\b`, 'i').test(haystack);
}

export function classifyIntent(text: string): Intent {
  if (!text || typeof text !== 'string') return 'unknown';
  const lower = text.toLowerCase();

  let bestIntent: Intent = 'unknown';
  let bestScore = 0;

  for (const rule of RULES) {
    let score = 0;
    for (const k of rule.keywords) {
      if (keywordMatches(lower, k)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  return bestScore >= MIN_SCORE ? bestIntent : 'unknown';
}

export const intentClassifier = { classifyIntent };
