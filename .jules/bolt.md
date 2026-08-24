## 2024-06-25 - Avoid O(N*M) string matching with precompiled regex

**Learning:** Static arrays initialized inside request handlers (`keywordsMap` in `/questions` analytics route) recreate objects and cause garbage collection overhead per request. Nested iterations `keywords.some(k => string.includes(k))` across large arrays scale poorly (O(N*M)).

**Action:** Precompile known static text classifications to module-scope `RegExp` arrays (e.g., `/{ category: string, regex: RegExp }[]/`). Use `regex.test(content)` to efficiently evaluate text without memory re-allocation or word boundaries causing functional regressions.
