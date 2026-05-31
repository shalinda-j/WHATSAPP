## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2024-05-31 - [High] Insecure Direct Object Reference (IDOR) in Workflow Endpoints
**Vulnerability:** The workflow endpoints used Mongoose methods like `findById`, `findByIdAndUpdate`, and `findByIdAndDelete` which query the database by ID without ensuring the user has access to the tenant associated with the resource. This allows users in one tenant to access and modify workflows in another tenant simply by guessing the workflow's Object ID.
**Learning:** In a multi-tenant architecture where documents are tenant-scoped, we must ensure the `_id` lookup includes the active tenant id context. Any endpoint doing an ID-based query can expose an IDOR if tenant scope is ignored.
**Prevention:** Always use `findOne()`, `findOneAndUpdate()`, or `findOneAndDelete()` paired with `withTenantScope(req, { _id: req.params.id })` for resource modifications. Avoid `findById`, `findByIdAndUpdate`, and `findByIdAndDelete` unless you explicitly intend to bypass tenant isolation (e.g., in a background job without user context).
