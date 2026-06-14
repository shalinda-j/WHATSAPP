## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-06-14 - Precompile RegExp vs Array.some for string inclusions

**Learning:** In performance-sensitive loops, using `Array.some()` with `String.includes()` against a newly created or locally scoped array causes unnecessary garbage collection overhead and O(M*N) CPU bottlenecks.
**Action:** Precompile static keywords into `RegExp` objects at the module scope. In the request loop, use `regex.test(string)`. Ensure you avoid inadvertently wrapping patterns in word boundaries (e.g., `\b`) if the original logic relied on simple substring matching, as this could cause functional regressions.
