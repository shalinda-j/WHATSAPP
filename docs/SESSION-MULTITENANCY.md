# Session multi-tenancy (Finding #66)

## Current state

`Session.sessionId` is **globally unique** (`unique: true` in
`src/models/Session.ts`). For the current single-tenant deployment this is
correct and bug-free. It only becomes a problem if **two different tenants**
try to create a session with the **same `sessionId`** (e.g. both using the
hardcoded `'default'` session) — that would raise a Mongo `E11000`
duplicate-key error.

## What was changed now (safe, zero-regression)

- `Session` gained an **optional `tenantId`** field (`src/models/Session.ts`),
  indexed, so sessions are tenant-attributable.
- New sessions created via `POST /api/sessions` are **stamped with the owning
  tenant** (`req.tenant._id`) in `src/server/routes/sessions.ts`.
- `sessionId` is **left globally unique** — so **no database migration is
  required** and existing behavior is unchanged.

This is deliberately a forward-compatible step, not the full fix: it does not by
itself allow two tenants to share a `sessionId`.

## Deferred: full per-tenant uniqueness (planned migration)

Making `sessionId` unique _per tenant_ is an architecture migration, not a
surgical edit, and is **deliberately deferred** to avoid introducing
regressions. It requires all of:

1. **Schema:** drop the global `unique` on `sessionId`; add a compound unique
   index `{ tenantId: 1, sessionId: 1 }`.
2. **Data/index migration:** a one-off script must **backfill `tenantId`** on
   every existing `Session` and **drop the old `sessionId_1` unique index**
   (Mongoose `autoIndex` will NOT drop it automatically — leaving it would keep
   `sessionId` globally unique and silently defeat the change).
3. **Query call sites (17 across 5 files):** scope every `Session` query by
   `tenantId` — `src/services/whatsapp.ts` (×7, the session manager + the
   hardcoded `sessionId: 'default'` lookups), `src/server/routes/sessions.ts`
   (×6), `src/server/routes/chat.ts`, `src/server/routes/exports.ts`,
   `src/server/controllers/SystemController.ts`. Several of these run on the
   boot/auto-restart path where there is **no request-scoped tenant context**,
   so tenant resolution must be introduced there first.

Because (2) touches a live unique index and (3) touches the connection-manager
boot path, this should be done as a single planned migration with a backup and
tested rollback — not as part of a bug-fix sweep.

## Status

Tracked as finding **#66**: partially addressed (tenantId added + stamped on
create); full per-tenant uniqueness **deferred to a planned migration** as
documented above.
