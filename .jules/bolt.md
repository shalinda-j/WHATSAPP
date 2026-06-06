## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-05-19 - Precompile RegExp for static keyword matching to eliminate O(M*N) CPU bottlenecks

**Learning:** Recreating static string arrays (like `keywordsMap` in `analytics.ts`) inside a request handler and using nested array loops (e.g., `Array.some()` wrapping `String.includes()`) causes a significant O(M*N) CPU bottleneck per request. It also introduces unnecessary garbage collection overhead by repeatedly allocating those objects.
**Action:** When performing static keyword categorization inside highly trafficked request handlers, move the static dictionaries outside the handler scope. Precompile keyword lists into `RegExp` objects (e.g., `/(keyword1|keyword2)/i`) to turn substring searching into heavily optimized regex testing. Additionally, when fetching large collections (like chat messages) solely to process small fields, add `.select('field')` alongside `.lean()` to minimize memory footprint.
