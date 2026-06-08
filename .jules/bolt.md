## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2026-06-08 - CPU and Memory Overhead of Inner-Loop Array Operations for Pattern Matching

**Learning:** Recreating objects/arrays (like `keywordsMap`) per request and using nested `Array.some()` combined with `String.includes()` introduces an O(M*N) CPU bottleneck and unnecessary Garbage Collection overhead. Using `Object.entries()` to iterate over a map also allocates a new array each time. Precompiling string categories into module-scoped `RegExp` objects and iterating over them with a manual `for...in` loop (using `.hasOwnProperty`) eliminates these allocations and executes significantly faster.
**Action:** For static keyword categorization in request handlers, precompile keywords into `RegExp` objects at the module scope. In performance-sensitive code processing objects, use a manual `for...in` loop with `hasOwnProperty` checks instead of `Object.keys(obj).length` or `Object.entries()` to avoid array allocations.
