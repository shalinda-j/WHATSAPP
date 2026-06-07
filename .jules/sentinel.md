## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2024-10-31 - Fix Mass Assignment and IDOR in Lead Routes
**Vulnerability:** `router.put('/:id')` in `src/server/routes/leads.ts` was passing `...req.body` directly into `Lead.findByIdAndUpdate()`, leading to mass assignment vulnerabilities where attackers could overwrite sensitive fields like `tenantId` or `score`. Additionally, endpoints such as `router.get('/:id')` and `router.delete('/:id')` lacked tenant scoping, resulting in Insecure Direct Object Reference (IDOR) vulnerabilities where an attacker could access or modify leads belonging to other tenants.
**Learning:** Avoid using `{ ...req.body }` directly in database updates. Mongoose's `findById` methods do not natively support complex query objects needed for tenant scoping middleware.
**Prevention:** Use explicit field extraction for database updates. Use `findOne` with `withTenantScope` wrapper instead of `findById` to prevent cross-tenant IDOR access.
