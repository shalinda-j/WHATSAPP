import { messageMatchesKeyword } from '../utils/keywordMatch';

const ACCEPT = ['yes', 'yeah', 'yep', 'ya', 'ow', 'ovu', 'ok', 'okay', 'sure', 'y'];
const REJECT = ['no', 'nah', 'not', 'epa', 'cancel', 'stop', 'later', 'pasuwa', 'no thanks'];

describe('messageMatchesKeyword — booking acceptance detection', () => {
  it('accepts a bare "yes"', () => {
    expect(messageMatchesKeyword('yes', ACCEPT)).toBe(true);
  });

  it('accepts a natural-language yes with extra words (the field bug)', () => {
    // The exact reply from the reported screenshot that used to be misread as
    // a rejection because the old check required the whole message to be "yes".
    expect(messageMatchesKeyword('Yes 9.30 vage anna hithan inna', ACCEPT)).toBe(
      true,
    );
    expect(messageMatchesKeyword('ok sure lets do it', ACCEPT)).toBe(true);
    expect(messageMatchesKeyword('ovu mata enna puluwan', ACCEPT)).toBe(true);
  });

  it('does not treat these as acceptance', () => {
    // No acceptance token present.
    expect(messageMatchesKeyword('what time is available?', ACCEPT)).toBe(false);
    expect(messageMatchesKeyword('no', ACCEPT)).toBe(false);
  });

  it('short single-char keywords never match as substrings', () => {
    // 'y' must not match inside "why"; 'ow' must not match inside "now".
    expect(messageMatchesKeyword('why not', ACCEPT)).toBe(false);
    expect(messageMatchesKeyword('now', ACCEPT)).toBe(false);
    // But a standalone 'y' still counts.
    expect(messageMatchesKeyword('y', ACCEPT)).toBe(true);
  });

  it('detects clear rejections (whole word + phrase)', () => {
    expect(messageMatchesKeyword('no', REJECT)).toBe(true);
    expect(messageMatchesKeyword('no thanks', REJECT)).toBe(true);
    expect(messageMatchesKeyword('epa mata be', REJECT)).toBe(true);
    expect(messageMatchesKeyword('maybe later', REJECT)).toBe(true);
  });

  it('handles empty / whitespace input safely', () => {
    expect(messageMatchesKeyword('', ACCEPT)).toBe(false);
    expect(messageMatchesKeyword('   ', ACCEPT)).toBe(false);
  });
});
