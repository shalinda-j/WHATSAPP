## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.
## 2025-03-09 - Code Performance: Precompile keywords to RegExp

**Learning:** Recreating static dictionary arrays and executing nested iterations with `Array.some()` and `String.includes()` inside a request loop causes O(M*N) CPU overhead and unnecessary Garbage Collection. When resolving this, replacing it with module-scope precompiled RegExp is optimal, but you must avoid appending word boundaries (`\b`) if the original implementation used raw substring matching (`String.includes`), to avoid breaking compatibility for partial matches.
**Action:** When replacing `String.includes()` loops with Regex tests for performance, omit `\b` word boundaries to maintain identical substring behavior unless exact match semantics are explicitly requested.
