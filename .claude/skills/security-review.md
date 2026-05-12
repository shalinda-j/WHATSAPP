---
name: security-review
description: Run a focused security review of the pending diff or named files — auth, secrets, input validation, encryption, dependency CVEs.
---

# Security Review Skill

## When to invoke
- Before merging a PR that touches auth, encryption, secrets, or external input
- When user asks for a "security review" or "security audit"
- After dependency bumps (`npm audit`)

## Procedure

1. **Identify scope**: `git diff` (or specific files passed as args).
2. **Run automated checks** in parallel:
   - `npm audit --audit-level=moderate` — flag CVEs
   - Grep for hardcoded secrets: `(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]+['"]`
   - Grep for `console.log` of suspicious vars (key, token, secret)
3. **Manual review** against [security-specialist checklist](../agents/security-specialist.md):
   - No hardcoded secrets
   - Inputs from WhatsApp pass `SecurityService.isSafe()`
   - AI prompts checked for jailbreak keywords
   - New routes mount `authenticateToken` unless public
   - API keys encrypted via `CryptoService`
   - bcrypt cost ≥ 10
   - No stack traces in production responses
4. **Output report** with severity-labeled findings:
   - `[critical]` blocks merge
   - `[high]` should fix before merge
   - `[medium]` fix this sprint
   - `[low]` / `[nit]` track but don't block
5. **Final verdict**: Approve / Approve with comments / Request changes.

## Output format
```
## Security Review — <date>
Scope: <files reviewed>
Findings: N critical, M high, K medium

### Critical
- file:line — <issue> → <fix>

### High
- ...

Verdict: <decision>
```
