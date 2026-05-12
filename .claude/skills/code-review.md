---
name: code-review
description: Pre-merge code review covering correctness, project conventions, TypeScript hygiene, and architectural fit.
---

# Code Review Skill

## When to invoke
- Before merging non-trivial changes
- When user asks for a "review" or "second opinion"
- After a feature is implemented but before QA validation

## Procedure

1. **Read the diff**: `git diff` or `git log -p -1`.
2. **Read surrounding context**: don't review files in isolation; load 2–3 nearby files.
3. **Check project conventions** (from `WHATSAPP/CLAUDE.md`):
   - Mongoose model type assertion: `as any) as unknown as mongoose.Model<I...>`
   - JID null-check before use
   - Sinhala default language
   - Log emoji markers (📩, 🤖, ✅, ❌, ⚠️, 📞, 🎤, 📅, 📝)
   - Commands implement `ICommand` and auto-register in `src/app/commands/index.ts`
4. **Cross-reference memory**: check [[issues-and-technical-debt-analysis]] and [[known-issues-and-fixes-status]] for prior incidents in the same area.
5. **Severity-tag findings**: critical / high / medium / low / nit.
6. **Verdict**: Approve / Approve with comments / Request changes.

## Output format
```
## Code Review — <branch/PR>
Files reviewed: N
Findings: <counts>

### Findings
[severity] file:line — <issue>
  Suggested: <fix or question>

Verdict: <decision>
```

## Hand-offs
- Security findings → `security-specialist`
- Performance findings → `performance-engineer`
- Test gaps → `qa-testing`
