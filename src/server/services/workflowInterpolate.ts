/**
 * Variable interpolation for workflow node configs.
 *
 * Each integration node's `data` can reference upstream node outputs via
 * Mustache-style placeholders:
 *
 *    {{trigger.userId}}              → the trigger payload's userId field
 *    {{node_1.output.contact.email}} → the output of node id "node_1"
 *    {{node_2.providerCallId}}       → top-level field on that node's result
 *
 * Resolution rules:
 *   - The token before the first dot is the source: `trigger`, or the
 *     literal node id (matches `node.id` in the workflow graph).
 *   - The rest is a dot-path walked over the value via safeGet.
 *   - Missing references become the empty string rather than throwing —
 *     a workflow with a typo'd placeholder should still run (and the log
 *     will record the empty substitution for debugging).
 *
 * Strings get interpolated in place. Objects/arrays recurse. Other types
 * pass through. This keeps the API surface tiny: callers hand us
 * `node.data` and a context object, get back a fully resolved copy.
 */

export interface InterpolationContext {
  trigger: unknown;
  upstream: Record<string, unknown>;
}

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function safeGet(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const segment of path) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

function resolveOne(expr: string, ctx: InterpolationContext): unknown {
  const parts = expr.split('.');
  if (parts.length === 0) return undefined;
  const root = parts[0];
  const rest = parts.slice(1);
  if (root === 'trigger') return safeGet(ctx.trigger, rest);
  // Anything else is a node id lookup. If the lookup returns an object with
  // an `output` field, the operator is usually after that — we walk the
  // path through both layers gracefully.
  const upstream = ctx.upstream[root];
  if (upstream === undefined) return undefined;
  // First try walking the path as-is; fall back to .output.X if the first
  // path attempt missed.
  const direct = safeGet(upstream, rest);
  if (direct !== undefined) return direct;
  if (
    typeof upstream === 'object' &&
    upstream !== null &&
    'output' in (upstream as Record<string, unknown>)
  ) {
    return safeGet((upstream as { output: unknown }).output, rest);
  }
  return undefined;
}

function interpolateString(s: string, ctx: InterpolationContext): string {
  return s.replace(PLACEHOLDER_RE, (_match, expr: string) => {
    const value = resolveOne(expr, ctx);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

export function interpolate<T>(value: T, ctx: InterpolationContext): T {
  if (typeof value === 'string') {
    return interpolateString(value, ctx) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, ctx)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, ctx);
    }
    return out as unknown as T;
  }
  return value;
}
