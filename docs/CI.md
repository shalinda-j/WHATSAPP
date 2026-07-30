# CI

## The failure mode that looks like a broken build

If **every** check on a PR fails within a few seconds of being created — including
ones that cannot fail, like `Complexity Analysis` (whose steps end in `|| true`)
or `PR Checks` (which only prints a summary) — the build is not broken. Look at
the job metadata:

```
conclusion:   failure
created_at:   2026-07-30T08:40:04Z
completed_at: 2026-07-30T08:40:06Z   ← 2 seconds
runner_id:    0
runner_name:  ""
```

`runner_id: 0` with an empty `runner_name` means **no runner was ever assigned**.
No step ran, which is why the logs 404 — there is no log to download. A code
change cannot cause this and a code change cannot fix it.

### Why it happens here

This repo is **private**, on a **personal** account. Private-repo Actions
minutes are metered against a monthly quota (2,000/month on Free, 3,000 on Pro);
public repos get unlimited free minutes. When the quota is exhausted, or the
account's spending limit is reached, GitHub accepts the workflow, creates the
jobs, and fails them immediately without scheduling a runner.

Fix it in one of these places — none of them are in this repository:

1. **Settings → Billing and plans → Plans and usage** — check Actions minutes
   used this cycle, and when the cycle resets (usually the 1st).
2. **Settings → Billing → Spending limit** — a $0 limit stops all billable
   minutes the moment the included quota runs out. Raising it lets jobs run.
3. **Make the repo public**, if that is acceptable — unlimited free minutes.
4. **Wait for the monthly reset**, then keep consumption under the quota.

## Keeping consumption under the quota

The quota is only a problem if we spend it faster than it refills, and this repo
used to spend it very fast: **12 billable jobs per push to a PR branch**, each
doing its own cold `npm install`, with nothing cancelling superseded runs. A
handful of force-pushes to one PR could cost an hour of runner time.

It is now **3 jobs per PR push**, one of which needs no checkout at all:

| Workflow           | On a PR push          | Elsewhere                      |
| ------------------ | --------------------- | ------------------------------ |
| `ci.yml`           | Backend, Frontend (2) | called by `deploy.yml` on main |
| `pull-request.yml` | PR Checks (1)         | —                              |
| `code-quality.yml` | —                     | Mondays                        |
| `security.yml`     | —                     | push to main + Sundays         |
| `issues.yml`       | —                     | issue events + daily           |

### The rules that got it there

- **Every PR-triggered workflow has a `concurrency` group with
  `cancel-in-progress`.** This is the single biggest saving. Without it, pushing
  three times to a branch runs three complete suites in parallel and you only
  ever read the last one. Pushes to real branches are not cancelled, so a main
  build always finishes.
- **One install per runner, cached.** `actions/setup-node` with `cache: 'npm'`
  restores `~/.npm`; on a dependency tree this size a cold install cost more
  than the checks it was setting up for.
- **No check runs twice.** `ESLint Analysis` and `TypeScript Check` were whole
  extra jobs re-running what `ci.yml` had already run. They are steps in
  `ci.yml` now.
- **Nothing expensive runs on an in-progress branch.** CodeQL on a feature
  branch tells you nothing you won't learn when it lands on main.
- **CodeQL runs one language, not two.** `javascript` and `typescript` both
  resolve to the same `javascript-typescript` extractor, so a
  `[javascript, typescript]` matrix scans the identical files twice and uploads
  duplicate findings for the same code.
- **A job that cannot succeed does not run.** `Dependency Review` needs GitHub
  Advanced Security, which a private repo on a personal plan doesn't have, so it
  is gated on the repo being public and self-skips until that is true.
- **Read the event payload before cloning the repo.** `PR Checks` replaced two
  jobs that each did a full-history clone (`fetch-depth: 0`) to count changed
  files — a number already sitting in `pull_request.changed_files`.

`src/__tests__/CiWorkflows.test.ts` asserts these invariants so they can't
silently regress.

## Lint in CI

`npm run lint` passes `--fix`. That is right locally and wrong in CI, where it
repairs violations and then reports success — a gate that fixes what it is
guarding isn't a gate. CI uses **`npm run lint:ci`** (no `--fix`).
