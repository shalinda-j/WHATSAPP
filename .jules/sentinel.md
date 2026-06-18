## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2024-05-18 - Tenant Isolation in Analytics Endpoints via Mongoose
**Vulnerability:** Insecure Direct Object Reference (IDOR) where `PATCH /bookings/:id` and `DELETE /bookings/:id` allowed modifying/deleting records belonging to other tenants.
**Learning:** Using Mongoose methods like `findByIdAndUpdate` or `findByIdAndDelete` directly with a URL parameter bypasses the tenant scoping middleware, allowing cross-tenant modifications.
**Prevention:** Always use `findOneAndUpdate` or `findOneAndDelete` and pass the filter through `withTenantScope(req, { _id: req.params.id })` to ensure the target document belongs to the requesting tenant.
