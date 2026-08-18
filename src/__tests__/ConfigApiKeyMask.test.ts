import { maskApiKey, redactConfig } from '../server/routes/config';

/**
 * The API key preview shown in the Edit Config dialog.
 *
 * GET /api/config never carries the real key — the schema getters decrypt it,
 * so returning a config document verbatim would hand every provider's secret
 * to any authed caller. That redaction was right, but it left the edit form
 * with an empty box and a "sk-..." placeholder, which is indistinguishable
 * from a provider that has no key at all. Operators read it as data loss.
 *
 * This is the middle ground: enough to recognise WHICH key is stored, not
 * enough to use it. The tests below are mostly about the second half — every
 * one of them is really asking "how much of the secret did we just print".
 */

describe('maskApiKey', () => {
  it('keeps a short prefix and the last four characters', () => {
    // The prefix catches an OpenAI key pasted into the Groq slot; the tail
    // distinguishes a rotated key from the one it replaced.
    expect(maskApiKey('sk-or-v1-0123456789abcdef')).toBe('sk-••••cdef');
  });

  it('reveals a fixed number of characters however long the key is', () => {
    // A proportional mask would leak more from longer keys, which is exactly
    // backwards — long keys are the high-entropy ones worth protecting.
    const short = maskApiKey('sk-' + 'a'.repeat(20));
    const long = maskApiKey('sk-' + 'a'.repeat(400));
    const visible = (masked?: string) =>
      (masked ?? '').replace(/•/g, '').length;
    expect(visible(short)).toBe(7);
    expect(visible(long)).toBe(7);
  });

  it('never prints more than a fraction of the key', () => {
    for (const len of [16, 20, 32, 51, 73, 164]) {
      const key = 'k'.repeat(len);
      const visible = (maskApiKey(key) ?? '').replace(/•/g, '').length;
      expect(visible / len).toBeLessThanOrEqual(0.5);
    }
  });

  it('drops the prefix for a shortish key, showing only the tail', () => {
    // At 12 characters, "first 3 plus last 4" would be well over half the
    // value. The identifying tail is worth more than the prefix, so the
    // prefix is what goes.
    expect(maskApiKey('abcdefghijkl')).toBe('••••ijkl');
  });

  it('reveals nothing at all from a very short value', () => {
    // Under 8 characters there is no amount worth showing — anything printed
    // is a meaningful share of the secret.
    expect(maskApiKey('abc')).toBe('••••');
    expect(maskApiKey('abcdefg')).toBe('••••');
    expect(maskApiKey('abcdefg')).not.toContain('a');
  });

  it('says nothing rather than "••••" when no key is stored', () => {
    // The dialog keys its whole "a key exists" branch off this being absent.
    // Returning a mask for an empty value would show a phantom key on a
    // provider that has none.
    expect(maskApiKey('')).toBeUndefined();
    expect(maskApiKey('   ')).toBeUndefined();
    expect(maskApiKey(undefined)).toBeUndefined();
    expect(maskApiKey(null)).toBeUndefined();
  });

  it('ignores a non-string, rather than stringifying it', () => {
    // A legacy row could hold anything; `String(value)` on an object would
    // print "[object Object]" as though it were a key.
    expect(maskApiKey(1234567890123456)).toBeUndefined();
    expect(maskApiKey({ apiKey: 'sk-secret' })).toBeUndefined();
    expect(maskApiKey(['sk-secret'])).toBeUndefined();
  });

  it('ignores surrounding whitespace when measuring the key', () => {
    // A pasted key often carries a trailing newline. Counting it would let a
    // 7-character secret take the long branch and print its prefix.
    expect(maskApiKey('  abcdefg\n')).toBe('••••');
    expect(maskApiKey('  sk-or-v1-0123456789abcdef  ')).toBe('sk-••••cdef');
  });

  it('produces a different mask for two different keys', () => {
    // The entire point: an operator has to be able to tell which key is in
    // the box, not merely that something is.
    expect(maskApiKey('sk-or-v1-000000000000aaaa')).not.toBe(
      maskApiKey('sk-or-v1-000000000000bbbb'),
    );
  });
});

describe('redactConfig', () => {
  const SECRET = 'sk-or-v1-0123456789abcdef';

  it('strips the key and reports that one exists', () => {
    const out = redactConfig({
      _id: '1',
      providerType: 'openrouter',
      apiKey: SECRET,
    });
    expect(out.apiKey).toBeUndefined();
    expect(out.hasApiKey).toBe(true);
  });

  it('leaves the secret nowhere in the serialised response', () => {
    // The real guarantee, checked against the whole payload rather than one
    // field — a future addition that copied apiKey into a nested object would
    // pass a field-level assertion and still ship the key.
    const out = redactConfig({ _id: '1', apiKey: SECRET, description: 'main' });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(JSON.stringify(out)).not.toContain('0123456789');
  });

  it('attaches a preview the edit form can show', () => {
    const out = redactConfig({ _id: '1', apiKey: SECRET });
    expect(out.apiKeyPreview).toBe('sk-••••cdef');
  });

  it('omits the preview entirely when no key is stored', () => {
    // The dialog branches on this: a preview here would render a phantom key
    // on a provider that has none.
    const out = redactConfig({ _id: '1', apiKey: '' });
    expect(out.hasApiKey).toBe(false);
    expect(out).not.toHaveProperty('apiKeyPreview');
    expect(redactConfig({ _id: '1' })).not.toHaveProperty('apiKeyPreview');
  });

  it('reads through a Mongoose document, where the getter decrypts', () => {
    // Documents arrive as models, not plain objects. Spreading one instead of
    // calling toObject() would copy internal fields and miss the getters, so
    // apiKey would survive as an encrypted blob under a different key.
    const doc = {
      toObject: () => ({ _id: '1', apiKey: SECRET, aiModel: 'x' }),
    };
    const out = redactConfig(doc);
    expect(out.apiKey).toBeUndefined();
    expect(out.aiModel).toBe('x');
    expect(out.apiKeyPreview).toBe('sk-••••cdef');
  });

  it('does not mutate the document it was handed', () => {
    const source = { _id: '1', apiKey: SECRET };
    redactConfig(source);
    expect(source.apiKey).toBe(SECRET);
  });
});
