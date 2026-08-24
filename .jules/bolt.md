## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.
## 2024-05-20 - O(M*N) Regex Compilation in Request Loops

**Learning:** Recreating static configuration objects (like keyword arrays) and running nested loops with `Array.some()` and `String.includes()` inside an Express request handler adds significant CPU overhead. For a dataset of M messages and N categories, this causes unnecessary garbage collection and string allocations per request.
**Action:** When categorizing text based on static keywords, hoist the mapping to the module scope and precompile the keywords into `RegExp` objects (e.g., `/(keyword1|keyword2)/i`). Then, inside the request loop, iterate over the precompiled regexes using `.test()`, which is highly optimized in V8.
