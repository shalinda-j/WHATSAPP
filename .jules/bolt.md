## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.
## 2026-06-05 - Precompile Static Regular Expressions
**Learning:** In `src/server/routes/analytics.ts`, the `/questions` endpoint recreated a dictionary of arrays and used nested loops with `Array.some` and `String.includes` for categorization on every request. This caused an O(M*N) CPU bottleneck and unnecessary GC overhead per request.
**Action:** For static keyword categorization, always pre-compile patterns into `RegExp` objects at the module scope and use `.test()` instead of iterating over keyword arrays on every request.
