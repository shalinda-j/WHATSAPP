## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2026-05-21 - Replace nested string inclusions with precompiled regexes
**Learning:** In routes that perform keyword categorization (like `/questions` in analytics), recreating nested dictionary mapping arrays and using `content.includes()` inside O(M*N) nested loops per request introduces measurable CPU bottlenecks, especially as array sizes or message volume grows.
**Action:** Always precompile constant keyword categories into `RegExp` objects outside of request execution loops, reducing substring scanning overhead to O(1) matching per category.
