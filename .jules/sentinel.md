## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.
## 2025-02-18 - Prevent Webhook Mass Assignment
**Vulnerability:** The Webhook routes (`POST /` and `PUT /:id`) were directly passing `req.body` into Mongoose's model constructor and `findOneAndUpdate` without explicitly selecting fields. This exposed a mass assignment vulnerability, allowing an attacker to modify sensitive internal properties like `tenantId` by simply including them in the API request payload.
**Learning:** Even internal API endpoints that use `withTenantScope` to isolate tenant data must be protected against mass assignment. Spreading `req.body` (e.g., `{ ...req.body }`) is an anti-pattern that can bypass authorization checks for fields like `tenantId` or `_id`.
**Prevention:** Always explicitly define an allowlist of properties (e.g., `['name', 'url', 'events', ...]`) when handling incoming payloads, and construct the database payload by checking `if (req.body[field] !== undefined)` to safely handle falsy values while ignoring missing or disallowed properties.
