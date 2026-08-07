import {
  buildChatNumbersMatch,
  countExportableChatNumbers,
  isExportableChatNumber,
  parseChatNumbersWindow,
} from '../server/routes/exports';

/**
 * Live Chat "export real numbers".
 *
 * All-time export was always possible server-side — omit `from` and `to` and no
 * timestamp filter is applied — but the UI opened pre-filled with the current
 * month and the only way to ask for everything was to clear both date fields by
 * hand. An operator exporting "all contacts" quietly got one month's worth with
 * no sign anything had been left out.
 *
 * These pin the window parsing and the match builder, which the CSV and the new
 * count endpoint now share. A count that describes a different selection from
 * the download is worse than no count, because the operator trusts it.
 */

describe('parseChatNumbersWindow', () => {
  it('produces no window when nothing is supplied — the all-time export', () => {
    // The whole point: an empty query must mean "no timestamp filter", not a
    // default range invented somewhere down the line.
    expect(parseChatNumbersWindow({})).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('treats blank strings as absent, not as invalid dates', () => {
    // The UI clears the inputs to ask for all-time, and empty inputs serialise
    // as ''. Passing those to new Date() would yield Invalid Date.
    expect(parseChatNumbersWindow({ from: '', to: '' })).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('parses an explicit range', () => {
    const { from, to } = parseChatNumbersWindow({
      from: '2026-01-01',
      to: '2026-02-01',
    });
    expect(from?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(to?.toISOString().slice(0, 10)).toBe('2026-02-01');
  });

  it('expands a YYYY-MM month into a UTC calendar month', () => {
    const { from, to } = parseChatNumbersWindow({ month: '2026-02' });
    expect(from?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    // Exclusive upper bound — the 1st of the next month.
    expect(to?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('lets an explicit range win over month', () => {
    const { from } = parseChatNumbersWindow({
      month: '2026-02',
      from: '2026-05-05',
    });
    expect(from?.toISOString().slice(0, 10)).toBe('2026-05-05');
  });

  it('ignores an unparseable date rather than filtering on Invalid Date', () => {
    // A NaN date in a $gte would match nothing and silently return an empty
    // CSV, which reads as "we have no contacts".
    expect(parseChatNumbersWindow({ from: 'not-a-date' }).from).toBeUndefined();
    expect(
      parseChatNumbersWindow({ month: '2026-13-99' }).from,
    ).toBeUndefined();
  });
});

describe('countExportableChatNumbers', () => {
  // Regression. The count endpoint reported every distinct chatter while the
  // CSV silently dropped anyone without a resolved phone (the UI ships
  // "include unresolved" OFF), so the panel promised 239 contacts and the file
  // delivered fewer, with nothing on screen to explain the gap. Both sides now
  // run this one predicate.
  const phones = ['94771234567', null, '94712345678', undefined, null];

  it('counts only dialable rows when unresolved are excluded', () => {
    expect(countExportableChatNumbers(phones, false)).toBe(2);
  });

  it('counts every row when unresolved are included', () => {
    expect(countExportableChatNumbers(phones, true)).toBe(5);
  });

  it('agrees with the per-row predicate the CSV filters on', () => {
    // If these two ever disagree, the number on screen stops describing the
    // file that downloads — which is the whole bug.
    for (const includeUnresolved of [true, false]) {
      const byPredicate = phones.filter((p) =>
        isExportableChatNumber(p, includeUnresolved),
      ).length;
      expect(countExportableChatNumbers(phones, includeUnresolved)).toBe(
        byPredicate,
      );
    }
  });

  it('treats an empty string as unresolved, not as a phone number', () => {
    // An empty phone column is exactly what made operators think the export
    // had lost its numbers.
    expect(isExportableChatNumber('', false)).toBe(false);
    expect(countExportableChatNumbers(['', '94771234567'], false)).toBe(1);
  });

  it('counts nothing from an empty selection', () => {
    expect(countExportableChatNumbers([], false)).toBe(0);
    expect(countExportableChatNumbers([], true)).toBe(0);
  });
});

describe('buildChatNumbersMatch', () => {
  it('omits the timestamp filter entirely for an all-time export', () => {
    const match = buildChatNumbersMatch({});
    expect(match).toEqual({ role: 'user' });
    expect(match).not.toHaveProperty('timestamp');
  });

  it('only ever counts inbound messages', () => {
    // The export is a list of people who wrote to us; including assistant rows
    // would add the bot's own JID to the contact list.
    expect(buildChatNumbersMatch({}).role).toBe('user');
  });

  it('builds a half-open range so the end date is not double-counted', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');
    expect(buildChatNumbersMatch({ from, to }).timestamp).toEqual({
      $gte: from,
      $lt: to,
    });
  });

  it('supports an open-ended range in either direction', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(buildChatNumbersMatch({ from }).timestamp).toEqual({ $gte: from });
    const to = new Date('2026-02-01T00:00:00Z');
    expect(buildChatNumbersMatch({ to }).timestamp).toEqual({ $lt: to });
  });

  it('does not scope by device when "all" is selected', () => {
    // 'all' is the UI's sentinel, not a real session id — matching on it
    // literally would return nothing.
    expect(buildChatNumbersMatch({ sessionId: 'all' })).not.toHaveProperty(
      'metadata.sessionId',
    );
    expect(buildChatNumbersMatch({ sessionId: '' })).not.toHaveProperty(
      'metadata.sessionId',
    );
  });

  it('scopes to the resolved session ids when a device is chosen', () => {
    const match = buildChatNumbersMatch({
      sessionId: 'My Phone',
      scopedSessionIds: ['sess-1', 'sess-2'],
    });
    expect(match['metadata.sessionId']).toEqual({
      $in: ['sess-1', 'sess-2'],
    });
  });

  it('falls back to the raw filter when the session could not be resolved', () => {
    // The operator picked something we could not look up; matching on what
    // they typed is better than silently exporting every device.
    const match = buildChatNumbersMatch({
      sessionId: 'sess-unknown',
      scopedSessionIds: [],
    });
    expect(match['metadata.sessionId']).toBe('sess-unknown');
  });

  it('combines a device and a window', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const match = buildChatNumbersMatch({
      sessionId: 'x',
      scopedSessionIds: ['sess-1'],
      from,
    });
    expect(match).toEqual({
      role: 'user',
      'metadata.sessionId': { $in: ['sess-1'] },
      timestamp: { $gte: from },
    });
  });
});
