## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.
## 2025-02-24 - Fix IDOR Vulnerabilities in Dataset Routes
**Vulnerability:** In `src/server/routes/datasets.ts`, read, update, and delete endpoints used unscoped queries like `findById` and `findByIdAndUpdate`. This allowed users to access and manipulate datasets belonging to other tenants if they knew or guessed the `_id` or `key`.
**Learning:** Even if `resolveTenant` middleware is applied to a route, Mongoose queries must explicitly enforce the tenant boundary. Unscoped methods like `findById` bypass the tenant scoping, leading to Insecure Direct Object References (IDOR).
**Prevention:** Always use `findOne(withTenantScope(req, { _id: req.params.id }))` and its equivalents (`findOneAndUpdate`, `findOneAndDelete`) for tenant-scoped data instead of unscoped `findById` methods to ensure data isolation.
