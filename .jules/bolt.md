## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-06-30 - O(M*N) string matching overhead in request handlers

**Learning:** When matching many messages against a dictionary of keywords, executing nested loops of `Array.some` and `String.includes` allocates new objects and re-evaluates the array repeatedly per request, introducing substantial CPU overhead and garbage collection pauses on hot paths.
**Action:** Always precompile dictionaries into `RegExp` maps at the module scope so they are only initialized once. When replacing substring matches, ensure regexes omit word boundaries to perfectly preserve `.includes()` semantics.
