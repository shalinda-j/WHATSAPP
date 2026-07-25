import {
  buildContactExportFilename,
  buildContactExportFilter,
  buildExportDateRange,
  parseExportDateBoundary,
  resolveContactDateField,
} from '../server/routes/exports';
import { parseConversationPaging } from '../server/routes/chat';

describe('resolveContactDateField', () => {
  it('accepts the whitelisted fields', () => {
    expect(resolveContactDateField('updatedAt')).toBe('updatedAt');
    expect(resolveContactDateField('lastContact')).toBe('lastContact');
    expect(resolveContactDateField('nextFollowUp')).toBe('nextFollowUp');
  });

  it('falls back to createdAt for anything else', () => {
    expect(resolveContactDateField('notes')).toBe('createdAt');
    expect(resolveContactDateField(undefined)).toBe('createdAt');
    expect(resolveContactDateField({ $ne: null })).toBe('createdAt');
  });
});

describe('parseExportDateBoundary', () => {
  it('expands a bare date to the whole UTC day', () => {
    expect(parseExportDateBoundary('2026-07-25', 'start')?.toISOString()).toBe(
      '2026-07-25T00:00:00.000Z',
    );
    expect(parseExportDateBoundary('2026-07-25', 'end')?.toISOString()).toBe(
      '2026-07-25T23:59:59.999Z',
    );
  });

  it('expands YYYY-MM to the whole calendar month', () => {
    expect(parseExportDateBoundary('2026-02', 'start')?.toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(parseExportDateBoundary('2026-02', 'end')?.toISOString()).toBe(
      '2026-02-28T23:59:59.999Z',
    );
  });

  it('reads a zone-less datetime as UTC and closes the end minute', () => {
    expect(
      parseExportDateBoundary('2026-07-25T14:30', 'start')?.toISOString(),
    ).toBe('2026-07-25T14:30:00.000Z');
    expect(
      parseExportDateBoundary('2026-07-25T14:30', 'end')?.toISOString(),
    ).toBe('2026-07-25T14:30:59.999Z');
  });

  it('honours an explicit offset on a full ISO timestamp', () => {
    expect(
      parseExportDateBoundary(
        '2026-07-25T05:30:00+05:30',
        'start',
      )?.toISOString(),
    ).toBe('2026-07-25T00:00:00.000Z');
  });

  it('returns null for empty or unparsable input', () => {
    expect(parseExportDateBoundary('', 'start')).toBeNull();
    expect(parseExportDateBoundary('   ', 'end')).toBeNull();
    expect(parseExportDateBoundary('not-a-date', 'start')).toBeNull();
    expect(parseExportDateBoundary(undefined, 'start')).toBeNull();
    expect(parseExportDateBoundary(42, 'start')).toBeNull();
  });
});

describe('buildExportDateRange', () => {
  it('is null when neither edge is usable', () => {
    expect(buildExportDateRange('', '')).toBeNull();
    expect(buildExportDateRange('garbage', undefined)).toBeNull();
  });

  it('supports open-ended windows', () => {
    expect(buildExportDateRange('2026-07-01', '')).toEqual({
      $gte: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(buildExportDateRange('', '2026-07-31')).toEqual({
      $lte: new Date('2026-07-31T23:59:59.999Z'),
    });
  });

  it('swaps reversed edges instead of returning nothing', () => {
    const range = buildExportDateRange('2026-07-31', '2026-07-01');
    expect(range?.$gte?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(range?.$lte?.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });
});

describe('buildContactExportFilter', () => {
  it('applies the window to the chosen date field', () => {
    const { filter, dateField } = buildContactExportFilter({
      dateField: 'lastContact',
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(dateField).toBe('lastContact');
    expect(filter.lastContact).toEqual({
      $gte: new Date('2026-07-01T00:00:00.000Z'),
      $lte: new Date('2026-07-31T23:59:59.999Z'),
    });
    expect(filter.createdAt).toBeUndefined();
  });

  it('omits the date clause entirely when no window is given', () => {
    const { filter } = buildContactExportFilter({});
    expect(filter).toEqual({});
  });

  it('carries the attribute filters through', () => {
    const { filter } = buildContactExportFilter({
      status: 'converted',
      type: 'customer',
      source: 'whatsapp',
      priority: 'high',
      tags: 'vip, israel',
    });
    expect(filter.status).toBe('converted');
    expect(filter.type).toBe('customer');
    expect(filter.source).toBe('whatsapp');
    expect(filter.priority).toBe('high');
    expect(filter.tags).toEqual({ $in: ['vip', 'israel'] });
  });

  it('maps the opt-out selector to a boolean clause', () => {
    expect(
      buildContactExportFilter({ optedOut: 'exclude' }).filter.optedOut,
    ).toEqual({ $ne: true });
    expect(buildContactExportFilter({ optedOut: 'only' }).filter.optedOut).toBe(
      true,
    );
    expect(
      buildContactExportFilter({ optedOut: 'all' }).filter.optedOut,
    ).toBeUndefined();
  });

  it('escapes regex metacharacters in the search term', () => {
    const { filter } = buildContactExportFilter({ search: 'a.b*c' });
    const or = (filter as any).$or as Array<Record<string, any>>;
    expect(or[0].name.$regex).toBe('a\\.b\\*c');
  });

  it('keeps the session, and search $or clauses from clobbering each other', () => {
    const { filter } = buildContactExportFilter({
      sessionId: 'device-1',
      search: 'nimal',
      status: 'new',
    });
    expect(filter.status).toBe('new');
    const and = (filter as any).$and as Array<Record<string, any>>;
    expect(and).toHaveLength(2);
    expect(and[0].$or).toEqual([
      { sessionId: 'device-1' },
      { sessionId: { $exists: false } },
    ]);
    expect(and[1].$or.length).toBeGreaterThan(1);
  });

  it('ignores the device scope when the operator picked "all"', () => {
    const { filter } = buildContactExportFilter({ sessionId: 'all' });
    expect(filter).toEqual({});
  });
});

describe('buildContactExportFilename', () => {
  it('records the window in the filename', () => {
    expect(
      buildContactExportFilename('createdAt', '2026-07-01', '2026-07-31'),
    ).toBe('crm-contacts-2026-07-01_2026-07-31.csv');
  });

  it('names the axis when it is not the default', () => {
    expect(buildContactExportFilename('lastContact', '2026-07-01', '')).toBe(
      'crm-contacts-lastContact-2026-07-01_any.csv',
    );
  });

  it('includes the device scope but skips "all"', () => {
    expect(
      buildContactExportFilename('createdAt', '2026-07-01', '', 'device-1'),
    ).toBe('crm-contacts-device-1-2026-07-01_any.csv');
    expect(
      buildContactExportFilename('createdAt', '2026-07-01', '', 'all'),
    ).toBe('crm-contacts-2026-07-01_any.csv');
  });
});

describe('parseConversationPaging', () => {
  it('defaults to the first page', () => {
    expect(parseConversationPaging({})).toEqual({ limit: 200, skip: 0 });
  });

  it('honours explicit paging', () => {
    expect(parseConversationPaging({ limit: '50', skip: '200' })).toEqual({
      limit: 50,
      skip: 200,
    });
    expect(parseConversationPaging({ limit: '50', offset: '100' })).toEqual({
      limit: 50,
      skip: 100,
    });
  });

  it('treats "all" / 0 as the maximum page size', () => {
    expect(parseConversationPaging({ limit: 'all' }).limit).toBe(1000);
    expect(parseConversationPaging({ limit: '0' }).limit).toBe(1000);
  });

  it('clamps out-of-range and junk values', () => {
    expect(parseConversationPaging({ limit: '999999' }).limit).toBe(1000);
    expect(parseConversationPaging({ limit: 'abc' }).limit).toBe(200);
    expect(parseConversationPaging({ skip: '-5' }).skip).toBe(0);
    expect(parseConversationPaging({ skip: 'abc' }).skip).toBe(0);
  });
});
