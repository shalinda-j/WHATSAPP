import { isStopKeyword } from '../services/optOut';

describe('isStopKeyword', () => {
  it('matches canonical English keywords as standalone messages', () => {
    expect(isStopKeyword('STOP')).toBe(true);
    expect(isStopKeyword('stop')).toBe(true);
    expect(isStopKeyword('Stop')).toBe(true);
    expect(isStopKeyword('UNSUBSCRIBE')).toBe(true);
    expect(isStopKeyword('opt out')).toBe(true);
    expect(isStopKeyword('opt-out')).toBe(true);
    expect(isStopKeyword('cancel')).toBe(true);
    expect(isStopKeyword('remove me')).toBe(true);
  });

  it('matches common Sinhala phrasings', () => {
    expect(isStopKeyword('aye epa')).toBe(true);
    expect(isStopKeyword('ayee epaa')).toBe(true);
    expect(isStopKeyword('stop karanna')).toBe(true);
    expect(isStopKeyword('navathanna')).toBe(true);
  });

  it('matches Tamil phrasings', () => {
    expect(isStopKeyword('niruthu')).toBe(true);
    expect(isStopKeyword('vendam')).toBe(true);
  });

  it('strips punctuation before matching', () => {
    expect(isStopKeyword('STOP.')).toBe(true);
    expect(isStopKeyword('STOP!')).toBe(true);
    expect(isStopKeyword('   STOP   ')).toBe(true);
    expect(isStopKeyword('"STOP"')).toBe(true);
  });

  it('does NOT match keywords embedded in a sentence', () => {
    expect(isStopKeyword('how do I stop the recurring payment?')).toBe(false);
    expect(isStopKeyword('please cancel my order #1234')).toBe(false);
    expect(
      isStopKeyword('I want to unsubscribe from the newsletter not the bot'),
    ).toBe(false);
    expect(isStopKeyword('do not stop sending me messages')).toBe(false);
  });

  it('handles falsy + edge inputs without throwing', () => {
    expect(isStopKeyword(undefined)).toBe(false);
    expect(isStopKeyword(null)).toBe(false);
    expect(isStopKeyword('')).toBe(false);
    expect(isStopKeyword('   ')).toBe(false);
    expect(isStopKeyword('x'.repeat(80))).toBe(false);
  });
});
