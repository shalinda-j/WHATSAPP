/**
 * Pure compiler: ContactSegment rule definitions → MongoDB filter object.
 *
 * Kept as its own module (no Mongoose imports, no I/O) so it's
 * deterministically unit-testable and reusable from cron jobs, ad-hoc
 * scripts, the API layer, and the SegmentationAgent's preview path.
 *
 * Field path convention: the rule.field is a dotted path scoped to a
 * named entity. Today only two entities exist:
 *
 *   contact.*   — paths on the Contact collection
 *   lead.*      — paths on the Lead collection
 *
 * The compiler returns ONE filter per entity (caller decides which
 * collection to query). Fields outside the supported scope produce a
 * warning and are dropped — the caller can surface those to the
 * operator, but they never silently produce a zero-match segment.
 */

export type RuleOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'exists';

export interface SegmentRule {
  field: string;
  operator: RuleOperator;
  value: unknown;
}

export type RuleScope = 'contact' | 'lead';

export interface CompileOptions {
  /** Which scope to compile for — paths from other scopes are dropped. */
  scope: RuleScope;
  /** Today's date for relative-date resolution. Defaults to new Date(). */
  now?: Date;
}

export interface CompileResult {
  /** Final Mongo filter. {} means "no narrowing rules applied". */
  filter: Record<string, unknown>;
  /** Rules dropped because their field wasn't in this scope. */
  droppedFields: string[];
  /** Rules with unsupported operator/value combos. */
  invalid: Array<{ rule: SegmentRule; reason: string }>;
}

// Mongo operator map. `contains` is special — it becomes a $regex.
const OPERATOR_MAP: Partial<Record<RuleOperator, string>> = {
  eq: '$eq',
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  in: '$in',
  nin: '$nin',
  exists: '$exists',
};

/**
 * Detects { '$relativeDaysAgo': N } shape and turns it into a real Date.
 * Lets the SegmentationAgent emit time windows portably without knowing
 * the current clock at LLM time.
 */
function resolveValue(value: unknown, now: Date): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)['$relativeDaysAgo'] === 'number'
  ) {
    const days = (value as Record<string, number>)['$relativeDaysAgo'];
    const out = new Date(now);
    out.setDate(out.getDate() - days);
    return out;
  }
  return value;
}

function stripScopePrefix(field: string, scope: RuleScope): string | null {
  const prefix = `${scope}.`;
  if (!field.startsWith(prefix)) return null;
  return field.slice(prefix.length);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileSingleRule(
  rule: SegmentRule,
  scope: RuleScope,
  now: Date,
): { field: string; clause: unknown } | { reason: string } {
  const path = stripScopePrefix(rule.field, scope);
  if (path === null) return { reason: 'wrong_scope' };

  const value = resolveValue(rule.value, now);

  switch (rule.operator) {
    case 'contains': {
      if (typeof value !== 'string') {
        return { reason: 'contains_requires_string_value' };
      }
      return {
        field: path,
        clause: { $regex: escapeRegex(value), $options: 'i' },
      };
    }
    case 'exists': {
      // Cast to boolean — most callers will send true|false but
      // truthy/falsy strings are common too.
      const truthy =
        value === true || value === 'true' || value === 1 || value === '1';
      return { field: path, clause: { $exists: truthy } };
    }
    case 'in':
    case 'nin': {
      if (!Array.isArray(value)) {
        return { reason: `${rule.operator}_requires_array_value` };
      }
      const op = OPERATOR_MAP[rule.operator];
      if (!op) return { reason: `unsupported_operator:${rule.operator}` };
      return { field: path, clause: { [op]: value } };
    }
    default: {
      const op = OPERATOR_MAP[rule.operator];
      if (!op) return { reason: `unsupported_operator:${rule.operator}` };
      return { field: path, clause: { [op]: value } };
    }
  }
}

/**
 * Merges multiple clauses for the same field path into a single
 * Mongo-shaped clause. This lets {gte: X} + {lt: Y} on the same field
 * produce a range filter instead of clobbering each other.
 */
function mergeClauses(
  agg: Record<string, any>,
  field: string,
  clause: any,
): void {
  if (!agg[field]) {
    agg[field] = clause;
    return;
  }
  const prev = agg[field];
  // If either side is a primitive (rare — would mean someone used $eq
  // implicitly), promote it into a wrapper.
  if (typeof prev !== 'object' || prev === null || Array.isArray(prev)) {
    agg[field] = { $eq: prev, ...clause };
    return;
  }
  agg[field] = { ...prev, ...clause };
}

/**
 * Compiles the AND-rules + OR-groups of a segment into one Mongo filter.
 *
 *   compile({ rules: [a, b], or: [[c, d]] }, { scope: 'contact' })
 *
 * becomes:
 *
 *   { $and: [ a, b ], $or: [ { $and: [ c, d ] } ] }
 *
 * Unless there's only one block, in which case it simplifies to the
 * inner shape so the resulting filter looks natural in the Mongo
 * explain output. `$or` on its own does not implicitly add `$and`.
 */
export function compileSegmentRules(
  rules: SegmentRule[],
  or: SegmentRule[][] | undefined,
  options: CompileOptions,
): CompileResult {
  const now = options.now ?? new Date();
  const droppedFields: string[] = [];
  const invalid: CompileResult['invalid'] = [];

  function compileGroup(group: SegmentRule[]): Record<string, unknown> {
    const agg: Record<string, any> = {};
    for (const rule of group) {
      const result = compileSingleRule(rule, options.scope, now);
      if ('reason' in result) {
        if (result.reason === 'wrong_scope') {
          droppedFields.push(rule.field);
        } else {
          invalid.push({ rule, reason: result.reason });
        }
        continue;
      }
      mergeClauses(agg, result.field, result.clause);
    }
    return agg;
  }

  const andBlock = compileGroup(rules);
  const orGroups = (or ?? [])
    .map(compileGroup)
    .filter((g) => Object.keys(g).length > 0);

  let filter: Record<string, unknown>;
  if (orGroups.length === 0) {
    filter = andBlock;
  } else if (Object.keys(andBlock).length === 0 && orGroups.length === 1) {
    filter = orGroups[0];
  } else if (Object.keys(andBlock).length === 0) {
    filter = { $or: orGroups };
  } else {
    filter = { ...andBlock, $or: orGroups };
  }

  return { filter, droppedFields, invalid };
}
