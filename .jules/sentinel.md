## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.
## 2024-05-18 - Mass Assignment in Webhook Routes
**Vulnerability:** The `POST /` and `PUT /:id` routes for managing webhooks in `src/server/routes/webhooks.ts` accepted the full `req.body` directly into Mongoose operations (`new Webhook({...req.body})` and `findOneAndUpdate(..., req.body)`). This allowed clients to perform mass assignment attacks by sending unexpected fields, potentially overriding sensitive properties like `tenantId` (in PUT requests).
**Learning:** Destructuring object payload and spreading properties without explicit validation exposes an application to data injection. Always filter `req.body` properties down to the expected subset prior to database assignments, ensuring strict control over user updates.
**Prevention:** Construct an explicit `updateData` object explicitly mapping the allowed destructured variables (e.g., `name`, `url`, `events`) instead of directly applying the `req.body` payload into model constructors or Mongoose update filters.
