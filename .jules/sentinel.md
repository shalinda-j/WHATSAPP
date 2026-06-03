## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2026-06-03 - [Mass Assignment and IDOR] Prevent Mass Assignment and IDOR in Lead Updates

**Vulnerability:** The `PUT /api/leads/:id` route was vulnerable to both Mass Assignment and Insecure Direct Object Reference (IDOR). It passed `{ ...req.body }` directly to `Lead.findByIdAndUpdate()`, allowing malicious users to overwrite sensitive fields (like `tenantId` or `crmContactId`) and update leads belonging to other tenants by providing an ID outside their scope.
**Learning:** Using `findByIdAndUpdate` and spreading `req.body` directly into the update payload without explicitly filtering properties and tenant scopes is a dangerous pattern that bypasses both schema validations (for unintended fields) and multi-tenancy boundaries.
**Prevention:** Always destructure `req.body` to explicitly extract allowed fields, checking for `!== undefined` before appending to the update object. Furthermore, wrap Mongoose query filters with `withTenantScope(req, filter)` (e.g., using `findOne` or `findOneAndUpdate` instead of unscoped `findById` methods) to ensure operations are strictly limited to the current tenant's data.
