## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2024-05-29 - [Mass Assignment & IDOR] Unscoped CRUD operations in Webhook endpoints
**Vulnerability:** The Webhooks CRUD API endpoints (`POST`, `PUT`, `DELETE`, `TEST`) directly passed `req.body` into `Webhook.findByIdAndUpdate()` and the constructor without explicitly picking fields, leading to Mass Assignment vulnerabilities. Similarly, `findById`, `findByIdAndUpdate`, and `findByIdAndDelete` were used without `withTenantScope()`, leading to Insecure Direct Object Reference (IDOR), potentially allowing tenants to access or modify other tenants' webhooks.
**Learning:** Destructuring assignment provides an explicit security boundary against Mass Assignment attacks. Using tenant scoping middleware is essential when querying tenant-scoped collections.
**Prevention:** Explicitly extract parameters from user input. Always use `withTenantScope` along with `findOneAndUpdate`, `findOneAndDelete`, or `findOne` when interacting with tenant-scoped collections.
