## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.

## 2024-05-19 - Precompile RegExp vs Array.some() + includes()

**Learning:** In request handlers like `GET /questions` in `src/server/routes/analytics.ts`, iterating over a message string with `msg.content.toLowerCase()` and checking an array of keyword strings with `.some(k => content.includes(k))` inside a nested loop results in O(M*N) complexity. It also forces string memory allocations for `.toLowerCase()` on every request. Recreating the keyword mapping object on every request compounds the overhead.
**Action:** Extract static keyword categorizations out of the request handler to module scope. Precompile the target keywords into case-insensitive `RegExp` objects (e.g., `/job|work/i`). Use `regex.test(content)` instead. Also remember not to automatically wrap with word boundaries `\b` unless explicitly needed, to avoid altering match logic from substring to whole word matching.
