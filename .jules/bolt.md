## 2024-05-19 - Use `.lean()` for read-only queries

**Learning:** In `src/server/routes/analytics.ts`, fetching documents with `find()` returns heavy Mongoose document instances. For read-only operations where we only need pure JavaScript objects, omitting `.lean()` drastically increases memory consumption and instantiation time.
**Action:** Always append `.lean()` to Mongoose `find()` queries when modifying or saving the documents is unnecessary. Additionally, combine it with `.select()` to fetch only the required fields to minimize memory footprint and network overhead.

## 2024-05-10 - Missing `.lean()` calls in analytics.ts

**Learning:** When using Mongoose to fetch read-only queries, not using `.lean()` adds unnecessary overhead since documents are hydrated as Mongoose objects. In performance-sensitive routes where we only need plain objects for serialization or simple reading, this overhead is noticeable, especially for analytics endpoints which fetch large volumes of chat messages or datasets.
**Action:** Always append `.lean()` to Mongoose read-only queries (e.g., `ChatMessage.find().lean()`) to bypass document hydration and improve performance.
## 2025-05-24 - Use .lean() on read-only KnowledgeEntry queries
**Learning:** Bypassing Mongoose document hydration with `.lean()` on read-only queries provides measurable performance benefits, especially for repeated read loops, APIs serving large JSON bodies, and formatting strings. However, when formatting code globally, we must restrict linting and fixing exclusively to the modified files to avoid polluting the PR with massive formatting diffs.
**Action:** Always append `.lean()` to read-only queries, and scope formatting/linting fixes directly to the individual files edited via `npx eslint <file> --fix`.
