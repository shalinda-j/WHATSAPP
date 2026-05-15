import {
  compileSegmentRules,
  SegmentRule,
} from '../services/SegmentRuleCompiler';

describe('compileSegmentRules', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');

  it('compiles a simple eq rule', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.country', operator: 'eq', value: 'LK' },
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    expect(out.filter).toEqual({ country: { $eq: 'LK' } });
    expect(out.droppedFields).toEqual([]);
    expect(out.invalid).toEqual([]);
  });

  it('merges gte+lt on the same field into a range', () => {
    const rules: SegmentRule[] = [
      { field: 'lead.age', operator: 'gte', value: 22 },
      { field: 'lead.age', operator: 'lt', value: 35 },
    ];
    const out = compileSegmentRules(rules, undefined, { scope: 'lead', now });
    expect(out.filter).toEqual({ age: { $gte: 22, $lt: 35 } });
  });

  it('drops fields outside the requested scope', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.country', operator: 'eq', value: 'LK' },
      { field: 'lead.status', operator: 'eq', value: 'new' }, // wrong scope
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    expect(out.filter).toEqual({ country: { $eq: 'LK' } });
    expect(out.droppedFields).toEqual(['lead.status']);
  });

  it('rewrites contains as a case-insensitive regex with escaped meta chars', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.tags', operator: 'contains', value: 'japan.factory' },
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    expect(out.filter).toEqual({
      tags: { $regex: 'japan\\.factory', $options: 'i' },
    });
  });

  it('rejects contains with non-string value', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.tags', operator: 'contains', value: 42 },
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    expect(out.invalid).toHaveLength(1);
    expect(out.invalid[0].reason).toBe('contains_requires_string_value');
    expect(out.filter).toEqual({});
  });

  it('coerces $relativeDaysAgo into a real Date', () => {
    const rules: SegmentRule[] = [
      {
        field: 'contact.lastInteractionAt',
        operator: 'gte',
        value: { $relativeDaysAgo: 30 },
      },
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    const clause = out.filter.lastInteractionAt as { $gte: Date };
    expect(clause.$gte).toBeInstanceOf(Date);
    // 30 days before 2026-05-15 is 2026-04-15
    expect((clause.$gte as Date).toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('requires array value for in / nin', () => {
    const rules: SegmentRule[] = [
      { field: 'lead.status', operator: 'in', value: 'new' },
    ];
    const out = compileSegmentRules(rules, undefined, { scope: 'lead', now });
    expect(out.invalid[0].reason).toBe('in_requires_array_value');
  });

  it('emits a Mongo $or block for OR groups', () => {
    const rules: SegmentRule[] = [];
    const or: SegmentRule[][] = [
      [{ field: 'lead.status', operator: 'eq', value: 'new' }],
      [{ field: 'lead.status', operator: 'eq', value: 'reviewed' }],
    ];
    const out = compileSegmentRules(rules, or, { scope: 'lead', now });
    expect(out.filter).toEqual({
      $or: [{ status: { $eq: 'new' } }, { status: { $eq: 'reviewed' } }],
    });
  });

  it('combines AND rules + OR groups into one filter', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.country', operator: 'eq', value: 'LK' },
    ];
    const or: SegmentRule[][] = [
      [{ field: 'contact.tags', operator: 'contains', value: 'vip' }],
      [{ field: 'contact.tags', operator: 'contains', value: 'whale' }],
    ];
    const out = compileSegmentRules(rules, or, { scope: 'contact', now });
    expect(out.filter).toMatchObject({
      country: { $eq: 'LK' },
      $or: [
        { tags: { $regex: 'vip', $options: 'i' } },
        { tags: { $regex: 'whale', $options: 'i' } },
      ],
    });
  });

  it('drops empty OR groups (e.g. when every rule in a group was wrong scope)', () => {
    const rules: SegmentRule[] = [];
    const or: SegmentRule[][] = [
      [{ field: 'lead.status', operator: 'eq', value: 'new' }], // wrong scope
    ];
    const out = compileSegmentRules(rules, or, { scope: 'contact', now });
    expect(out.filter).toEqual({});
    expect(out.droppedFields).toEqual(['lead.status']);
  });

  it('compiles exists with truthy variants correctly', () => {
    const rules: SegmentRule[] = [
      { field: 'contact.email', operator: 'exists', value: 'true' },
    ];
    const out = compileSegmentRules(rules, undefined, {
      scope: 'contact',
      now,
    });
    expect(out.filter).toEqual({ email: { $exists: true } });
  });

  it('returns an empty filter for an empty rule set', () => {
    const out = compileSegmentRules([], undefined, { scope: 'contact', now });
    expect(out.filter).toEqual({});
  });
});
