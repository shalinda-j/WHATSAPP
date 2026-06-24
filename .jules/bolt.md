## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-05-20 - Precompile regular expressions in request handlers

**Learning:** Recreating static configuration objects (like `keywordsMap`) and iterating over arrays with `Array.some(String.includes)` inside a high-throughput request loop introduces an O(M*N) CPU bottleneck and unnecessary Garbage Collection overhead.
**Action:** For static keyword categorization or pattern matching, precompile the keywords into `RegExp` objects at the module scope. Using `RegExp.test()` in the request loop is significantly faster and more memory-efficient than dynamic array methods.
