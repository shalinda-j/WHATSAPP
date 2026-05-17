import { scoreSentiment } from '../services/sentiment';

describe('scoreSentiment', () => {
  it('returns neutral for empty/undefined/whitespace input', () => {
    expect(scoreSentiment(undefined).label).toBe('neutral');
    expect(scoreSentiment(null).label).toBe('neutral');
    expect(scoreSentiment('').label).toBe('neutral');
    expect(scoreSentiment('   ').label).toBe('neutral');
    expect(scoreSentiment(undefined).matchedTerms).toBe(0);
  });

  it('scores clearly positive English messages', () => {
    const r = scoreSentiment('this is great, thanks!');
    expect(r.label).toBe('positive');
    expect(r.score).toBeGreaterThan(0);
    expect(r.matchedTerms).toBeGreaterThanOrEqual(1);
  });

  it('scores clearly negative English messages', () => {
    const r = scoreSentiment('terrible service, this is awful');
    expect(r.label).toBe('negative');
    expect(r.score).toBeLessThan(0);
  });

  it('flips polarity on negation', () => {
    const plain = scoreSentiment('this is good');
    const negated = scoreSentiment('this is not good');
    expect(plain.label).toBe('positive');
    expect(negated.label).toBe('negative');
  });

  it('amplifies with intensifiers but stays in [-1, 1]', () => {
    const mild = scoreSentiment('good');
    const strong = scoreSentiment('very very good');
    expect(strong.score).toBeGreaterThanOrEqual(mild.score);
    expect(strong.score).toBeLessThanOrEqual(1);
  });

  it('detects Sinhala phonetic sentiment', () => {
    expect(scoreSentiment('hodai bohoma stuti').label).toBe('positive');
    expect(scoreSentiment('naraka service').label).toBe('negative');
  });

  it('detects Tamil phonetic sentiment', () => {
    expect(scoreSentiment('nandri arumai').label).toBe('positive');
    expect(scoreSentiment('mosham service').label).toBe('negative');
  });

  it('short-circuits oversized messages to neutral', () => {
    expect(scoreSentiment('x'.repeat(5000)).label).toBe('neutral');
  });

  it('returns neutral when no terms match', () => {
    const r = scoreSentiment('hello, where do I file a tax form?');
    expect(r.label).toBe('neutral');
    expect(r.matchedTerms).toBe(0);
  });
});
