## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.
## 2024-10-25 - Prevent O(M*N) CPU bottlenecks in string matching

**Learning:** When evaluating user messages against multiple static category arrays using nested `Array.some()` inside loops, the app recreates arrays and incurs an O(M*N) CPU bottleneck, plus unnecessary GC overhead from `.toLowerCase()` string allocations on every request.
**Action:** Extract static keyword arrays to the module scope and precompile them into `RegExp` objects with the `/i` flag for case-insensitivity. Use `RegExp.test()` within loops to process direct string matching efficiently without recreating arrays per request.

## 2024-10-25 - Unintended changes from install scripts

**Learning:** Running `pnpm install` as a prerequisite for `pnpm test` or `pnpm lint` may modify or generate large lockfiles like `pnpm-lock.yaml`, leading to polluted pull requests.
**Action:** Always check `git status` after executing build or testing dependencies. If auto-generated files like `pnpm-lock.yaml` are not intentionally requested for the task, safely revert them using `git restore --staged` and discard them to keep commits strictly scoped.
