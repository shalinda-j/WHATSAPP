## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## $(date +%Y-%m-%d) - Precompile static Regex maps for substring matching
**Learning:** Recreating nested static objects and arrays on every request inside route handlers introduces unnecessary memory overhead and garbage collection pauses. Furthermore, nested `Array.some()` checks combined with `String.includes()` inside an O(M*N) loop for categorizing strings is an anti-pattern.
**Action:** Extract static keyword maps to the module scope and precompile them as `RegExp` objects (e.g., `/(job|work)/i`). This minimizes per-request allocation and allows utilizing highly optimized native Regex execution engines (`regex.test(str)`) instead of slower, purely JS-driven array iteration. Ensure you omit word boundaries (`\b`) to correctly replicate substring matching behavior.
