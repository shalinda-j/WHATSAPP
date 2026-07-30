import {
  DEFAULT_KIOSK_PERSONALITY,
  KIOSK_KB_LIMIT,
  RankableEntry,
  extractDatasetText,
  formatKnowledgeBlock,
  kioskDatasetService,
  rankEntries,
  scoreEntry,
  tokenize,
} from '../services/KioskDatasetService';

/**
 * The kiosk used to borrow the WhatsApp bot's brain: every consult turn shipped
 * the global personality plus up to 100 knowledge entries ordered by usage
 * count. On a branch enrollment terminal that meant a question about course fees
 * arrived alongside a hundred Q&As about overseas job visas, and the visitor
 * waited while it was all assembled.
 *
 * These cover the retrieval half — ranking, tokenising and formatting — which is
 * pure and where the behaviour that matters lives. The caching half is exercised
 * through the same public helpers plus the Mixed-content reader.
 */

const entry = (e: Partial<RankableEntry>): RankableEntry => ({
  question: '',
  answer: '',
  ...e,
});

describe('tokenize', () => {
  it('drops stopwords and single characters', () => {
    expect(tokenize('What is the fee for a course')).toEqual(['fee', 'course']);
  });

  it('keeps Sinhala, because that is what visitors actually speak', () => {
    // A plain \w+ split discards Sinhala entirely, which would leave the ranker
    // with an empty query for most kiosk utterances.
    const tokens = tokenize('පාඨමාලාවේ ගාස්තුව කීයද');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('පාඨමාලාවේ');
  });

  it('handles a Singlish sentence that mixes both scripts', () => {
    const tokens = tokenize('mama course fee ගැන දැනගන්න ඕන');
    expect(tokens).toContain('course');
    expect(tokens).toContain('fee');
    expect(tokens).toContain('ගැන');
  });

  it('is empty for punctuation and blanks', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ...!?  ')).toEqual([]);
  });
});

describe('scoreEntry', () => {
  const queryTokens = tokenize('course fee');

  it('weights a question match above an answer match', () => {
    const inQuestion = entry({
      question: 'What is the course fee?',
      answer: 'Unrelated text.',
    });
    const inAnswer = entry({
      question: 'Unrelated question.',
      answer: 'The course fee is 25000.',
    });
    expect(scoreEntry(queryTokens, inQuestion)).toBeGreaterThan(
      scoreEntry(queryTokens, inAnswer),
    );
  });

  it('counts curated tags', () => {
    const tagged = entry({
      question: 'Pricing',
      answer: 'Details',
      tags: ['course', 'fee'],
    });
    expect(scoreEntry(queryTokens, tagged)).toBeGreaterThan(0);
  });

  it('scores an entry with no overlap at zero', () => {
    expect(
      scoreEntry(queryTokens, entry({ question: 'Visa', answer: 'Passport' })),
    ).toBe(0);
  });

  it('never lets popularity outrank relevance', () => {
    // This is precisely the old bug: sorting the whole KB by usageCount handed
    // the model the most POPULAR entries regardless of what was asked.
    const popularButIrrelevant = entry({
      question: 'How do I get a visa?',
      answer: 'Passport and photos.',
      usageCount: 100,
      confidence: 1,
    });
    const relevantButUnused = entry({
      question: 'What is the course fee?',
      answer: 'It is 25000 rupees.',
      usageCount: 0,
      confidence: 0.5,
    });
    expect(scoreEntry(queryTokens, relevantButUnused)).toBeGreaterThan(
      scoreEntry(queryTokens, popularButIrrelevant),
    );
  });

  it('uses confidence only to break a tie', () => {
    const base = { question: 'Course fee', answer: 'Answer' };
    const high = entry({ ...base, confidence: 1 });
    const low = entry({ ...base, confidence: 0.2 });
    const diff = scoreEntry(queryTokens, high) - scoreEntry(queryTokens, low);
    expect(diff).toBeGreaterThan(0);
    // A tiebreak, not a ranking signal — it must not be able to lift an entry
    // over one with a genuine extra token match.
    expect(diff).toBeLessThan(1);
  });

  it('scores nothing when the query has no usable tokens', () => {
    expect(scoreEntry([], entry({ question: 'Course fee', answer: 'x' }))).toBe(
      0,
    );
  });
});

describe('rankEntries', () => {
  const pool: RankableEntry[] = [
    entry({ question: 'What is the course fee?', answer: '25000 rupees.' }),
    entry({
      question: 'Which courses do you offer?',
      answer: 'IT and English.',
    }),
    entry({ question: 'How do I get a visa?', answer: 'Passport and photos.' }),
    entry({ question: 'What are the office hours?', answer: '9 to 5.' }),
  ];

  it('returns only entries that actually match', () => {
    const ranked = rankEntries('course fee', pool);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.map((r) => r.question).join(' ')).not.toContain('visa');
    for (const r of ranked) {
      expect(scoreEntry(tokenize('course fee'), r)).toBeGreaterThan(0);
    }
  });

  it('puts the best match first', () => {
    expect(rankEntries('course fee', pool)[0].question).toBe(
      'What is the course fee?',
    );
  });

  it('caps the prompt at the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      entry({ question: `course fee question ${i}`, answer: 'answer' }),
    );
    expect(rankEntries('course fee', many)).toHaveLength(KIOSK_KB_LIMIT);
    expect(rankEntries('course fee', many, 3)).toHaveLength(3);
  });

  it('falls back to operator signal on a greeting with no keywords', () => {
    // The opening turn is often just "hello" — returning nothing would leave the
    // model with no knowledge at all on the most important turn of the visit.
    const withSignal = [
      entry({ question: 'Low', answer: 'a', confidence: 0.1 }),
      entry({ question: 'High', answer: 'b', confidence: 0.9 }),
    ];
    const ranked = rankEntries('a', withSignal);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].question).toBe('High');
  });

  it('returns nothing from an empty pool', () => {
    expect(rankEntries('course fee', [])).toEqual([]);
  });

  it('ranks a Sinhala query against Sinhala entries', () => {
    const siPool = [
      entry({ question: 'පාඨමාලා ගාස්තුව කීයද?', answer: 'රු. 25000' }),
      entry({ question: 'වීසා ගන්නේ කෙසේද?', answer: 'ගමන් බලපත්‍රය' }),
    ];
    const ranked = rankEntries('ගාස්තුව', siPool);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].answer).toBe('රු. 25000');
  });
});

describe('formatKnowledgeBlock', () => {
  it('renders Q/A pairs with a count', () => {
    const block = formatKnowledgeBlock([
      entry({ question: 'Fee?', answer: '25000' }),
    ]);
    expect(block).toContain('# Kiosk Knowledge Base (1 most relevant)');
    expect(block).toContain('Q: Fee?');
    expect(block).toContain('A: 25000');
  });

  it('is empty for no entries, so the prompt gets no dangling header', () => {
    expect(formatKnowledgeBlock([])).toBe('');
  });
});

describe('extractDatasetText', () => {
  it('reads a plain string', () => {
    expect(extractDatasetText('  hello  ')).toBe('hello');
  });

  it('prefers Sinhala, the kiosk default language', () => {
    expect(extractDatasetText({ en: 'English', si: 'සිංහල' })).toBe('සිංහල');
  });

  it('falls back through the other languages', () => {
    expect(extractDatasetText({ en: 'English' })).toBe('English');
    expect(extractDatasetText({ ta: 'தமிழ்' })).toBe('தமிழ்');
  });

  it('never renders an object into the prompt', () => {
    // content is a Mixed field; a nested shape used to stringify as
    // "[object Object]" straight into the system prompt.
    expect(extractDatasetText({ nested: { deep: 'x' } })).toBe('');
    expect(extractDatasetText(null)).toBe('');
    expect(extractDatasetText(undefined)).toBe('');
    expect(extractDatasetText({ si: '   ' })).toBe('');
  });
});

describe('visitor profile cache', () => {
  beforeEach(() => kioskDatasetService.clearAll());

  it('loads a visitor once per session, not once per utterance', async () => {
    // The whole latency argument. The underlying reads — a Lead lookup and the
    // last ten ChatMessages — cannot change while somebody is standing at the
    // terminal, yet they ran on every turn and rebuilt an identical string.
    let calls = 0;
    const loader = async () => {
      calls++;
      return 'Lead පැතිකඩ: නම Nimal';
    };

    const first = await kioskDatasetService.getVisitorProfile('inv1', loader);
    const second = await kioskDatasetService.getVisitorProfile('inv1', loader);
    const third = await kioskDatasetService.getVisitorProfile('inv1', loader);

    expect(calls).toBe(1);
    expect(first).toBe('Lead පැතිකඩ: නම Nimal');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('keeps sessions separate', async () => {
    await kioskDatasetService.getVisitorProfile('inv1', async () => 'A');
    const other = await kioskDatasetService.getVisitorProfile(
      'inv2',
      async () => 'B',
    );
    expect(other).toBe('B');
  });

  it('caches an empty profile, so a first-time visitor is not re-queried', async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return '';
    };
    expect(await kioskDatasetService.getVisitorProfile('inv3', loader)).toBe(
      '',
    );
    expect(await kioskDatasetService.getVisitorProfile('inv3', loader)).toBe(
      '',
    );
    expect(calls).toBe(1);
  });

  it('swallows a loader failure and does not poison the session', async () => {
    const value = await kioskDatasetService.getVisitorProfile('inv4', () =>
      Promise.reject(new Error('mongo down')),
    );
    // A consult turn must still run — personalisation is an enhancement, not a
    // precondition.
    expect(value).toBe('');
  });

  it('releases the profile when the visit ends', async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return 'history';
    };
    await kioskDatasetService.getVisitorProfile('inv5', loader);
    // /convert and /enroll call this — a stranger's WhatsApp history shouldn't
    // sit in memory for the rest of the TTL after they walk away.
    kioskDatasetService.invalidateVisitor('inv5');
    await kioskDatasetService.getVisitorProfile('inv5', loader);
    expect(calls).toBe(2);
  });

  it('falls back to the loader when there is no invite id', async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return 'x';
    };
    await kioskDatasetService.getVisitorProfile('', loader);
    await kioskDatasetService.getVisitorProfile('', loader);
    // Nothing to key a cache on, so it must not collapse unrelated visitors
    // onto one shared entry.
    expect(calls).toBe(2);
  });
});

describe('default kiosk personality', () => {
  it('keeps the behaviour the route used to hard-code', () => {
    // Seeding is optional: with no KIOSK_PERSONALITY dataset row the kiosk must
    // behave exactly as it did before this layer existed.
    expect(DEFAULT_KIOSK_PERSONALITY).toContain('හඬ');
    expect(DEFAULT_KIOSK_PERSONALITY).toMatch(/knowledge base/i);
    expect(DEFAULT_KIOSK_PERSONALITY).toMatch(/never invent/i);
  });
});
