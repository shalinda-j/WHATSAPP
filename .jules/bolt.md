## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-05-19 - Precompiling RegExp to avoid O(M*N) nested loops in analytics

**Learning:** Recreating static keyword arrays (like `keywordsMap`) and iterating using a nested `Array.some((k) => content.includes(k))` inside a loop over database results scales terribly (O(M*N)) and puts unnecessary pressure on the garbage collector. Precompiling these categories into module-scoped `RegExp` objects reduces the overhead to a single, highly-optimized `.test()` execution per category. We must ensure we omit the word boundary (`\b`) logic to preserve the exact substring-matching behavior originally implemented via `.includes()`.
**Action:** When categorizing large volumes of text statically, precompile `RegExp` expressions at the module scope and replace dynamic `Array.some()` + `String.includes()` iterations with a single `.test()` call per category to alleviate CPU bottlenecks.
