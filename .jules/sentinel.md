## 2025-02-19 - [Timing Attack] Timing-Safe Equality Check in Webhook Verification
**Vulnerability:** The inbound webhook validation in `src/server/routes/webhooks.ts` used a simple string comparison (`secret !== process.env.WEBHOOK_SECRET`) which returns immediately when a mismatching character is found. This side channel can leak the expected string length and the correct characters of the secret byte-by-byte (a timing attack).
**Learning:** Traditional `===` or `!==` string comparison operators in Javascript execute in time proportional to the matching prefix length and are insecure for comparing sensitive secrets, API keys, passwords, or tokens.
**Prevention:** Use `crypto.timingSafeEqual` with inputs of guaranteed equal length (e.g., comparing SHA-256 hashes of both strings, since `timingSafeEqual` throws if lengths differ) to provide a constant-time comparison.
## 2024-05-11 - [Timing Attack in Webhook Secret Validation]
**Vulnerability:** A simple string comparison (`!==`) was used to validate the `WEBHOOK_SECRET` against the incoming payload secret in the webhook inbound endpoint.
**Learning:** Simple string comparison can expose the application to timing attacks, where an attacker can theoretically guess the secret character by character by measuring the time it takes for the comparison to fail.
**Prevention:** Use `crypto.timingSafeEqual` with a constant-time comparison algorithm (such as SHA-256 hashes of the strings) to ensure that comparisons always take the same amount of time, regardless of whether they succeed or fail.

## 2026-05-13 - [Path Traversal in CV Deletion]
**Vulnerability:** The CV deletion route in `src/server/routes/crm.ts` used an unsanitized database field (`registration.cvUrl`) to construct the file path via `path.join(__dirname, '../../..', registration.cvUrl)`. If a user could manipulate this field via other endpoints, they could achieve arbitrary file deletion via directory traversal payloads (e.g., `../../../etc/passwd`).
**Learning:** Fields stored in the database, even if generated internally, can be vulnerable to mass assignment or indirect manipulation. Never implicitly trust them when interacting with the file system.
**Prevention:** Always validate and sanitize paths using `path.resolve` and ensure the resulting absolute path begins exactly with the intended base directory using `filePath.startsWith(baseDirectory + path.sep)` to prevent both directory traversal and partial directory name match bypasses.
