## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification

**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.

## 2024-05-11 - [Timing Attack in Webhook Secret Validation]

**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## $(date +%Y-%m-%d) - [IDOR and Mass Assignment] Insecure Direct Object Reference and Unvalidated Updates

**Vulnerability:** Several endpoints in `src/server/routes/leads.ts` used unscoped Mongoose queries (`Lead.findById`, `Lead.findByIdAndUpdate`, `Lead.findByIdAndDelete`) which permitted users to access or modify leads belonging to other tenants by manipulating the `id` parameter. Furthermore, the `PUT /:id` endpoint suffered from mass assignment, blindly spreading `req.body` into the update object, allowing injection of sensitive fields like `tenantId` or `crmContactId`.
**Learning:** Database lookups in multi-tenant environments must always enforce tenant isolation. Spreading `req.body` directly into database operations provides an attack vector for overriding sensitive, server-controlled properties. Running formatters automatically might modify unrelated files, which introduces noise during security reviews.
**Prevention:** Use Mongoose's `findOne` and `findOneAndUpdate` in conjunction with `withTenantScope` instead of unscoped `findById` variants. Always explicitly extract, validate, and construct the update object with only permitted fields rather than relying on blacklisting or spreading unstructured user input. Make targeted security commits without conflating with arbitrary code style updates.
