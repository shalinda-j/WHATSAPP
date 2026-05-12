---
name: performance-audit
description: Profile hot paths, hunt memory leaks, and benchmark critical flows. Measure before optimizing.
---

# Performance Audit Skill

## When to invoke
- Reported slow responses (chat, API, dashboard)
- Memory growth over time (RSS climbing)
- Before scaling to higher traffic
- Bundle size regressions

## Procedure

1. **Baseline first** — measure current state. Never optimize blind.
   - HTTP: `autocannon` or `k6` for p50/p95/p99
   - Memory: heap snapshot via `node --inspect`
   - Mongo: enable slow query log (>100ms)
   - Frontend: `npm run build` → check `client/dist/` size; Vite bundle analyzer
2. **Identify hotspot** under realistic (not synthetic) load.
3. **Hypothesis**: "I think X is slow because Y" — write it down.
4. **Change one thing**, re-measure.
5. **Compare against baseline**. If no improvement, revert.
6. **Document findings** — what was tried, what worked, what didn't.

## Common hotspots to check
- Unbounded Maps (rate limiter, auto-registration, NLP cache)
- Synchronous `console.log` in hot paths (use pino instead)
- Missing `.lean()` on read-only Mongoose queries
- Missing indexes on hot lookup paths (`whatsappId`, `sessionId`, `phoneNumber`)
- AI provider fallback without per-provider timeout
- Frontend: ReactFlow/Recharts not code-split

## Output format
```
## Performance Audit — <target>
Baseline: <metrics>
Hotspot: <location>
Hypothesis: <description>
Change: <what you tried>
Result: <new metrics, delta>
Verdict: <kept / reverted>
```
