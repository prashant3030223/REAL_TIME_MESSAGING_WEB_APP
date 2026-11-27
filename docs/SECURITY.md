
## Current status

The API now implements email/username registration, password sign-in, session lookup, and current-session logout. Passwords are stored as salted scrypt hashes (`N=32768`, `r=8`, `p=1`); sessions use cryptographically random bearer values, store only SHA-256 token hashes, expire after seven days, and are delivered in HttpOnly, SameSite=Strict cookies (Secure in production). Auth state-changing requests require JSON, and registration/sign-in have an in-process IP rate limit. Integration tests exercise persistence and revocation against a dedicated PostgreSQL test database.

The API foundation also uses Helmet defaults, request IDs, body-size limits, sanitized JSON errors, and Pino structured logging with tested credential redaction. Email verification and account recovery are not implemented. Registration currently creates a usable account without verifying ownership of the email address; this is a known gap against the P0 product requirement. The PCR estimator is a local pure function and does not process credentials or persist telemetry. This document is not a security certification or audit.

## Required controls before a pilot

- Use a maintained authentication implementation; store only password hashes if passwords are used. Rate-limit sign-in, recovery, and account discovery.
- Prefer secure, HttpOnly, SameSite cookies for browser sessions, with CSRF protection for state-changing requests. Expire, rotate, and revoke sessions server-side.
- Authorize every resource operation on the server; never trust client-provided user IDs, roles, membership, or call permissions.
- Validate request bodies and query parameters; return consistent errors without internal details. Set security headers and a strict, environment-specific CORS policy.
- Keep credentials in deployment secret management; use placeholders only in example configuration. Never log passwords, tokens, private messages, or encryption keys.
- Keep media private. Validate size and content, authorize upload/download, use generated object keys, and avoid trusting extensions or MIME headers alone.
- Add audit events for sensitive administrative actions; minimize and redact telemetry.
- Define deletion/export and retention behavior before persisting user data.
- Review dependencies and run authorization, session-expiry, rate-limit, and upload security tests.
- Replace the in-process authentication limiter with shared rate-limit state before running multiple API instances.
- Add email ownership verification and account recovery before a public pilot; configure a mail delivery provider and token lifecycle rather than logging or returning verification secrets.
- Do not claim end-to-end encryption until an established protocol, device/key lifecycle, backups, and multi-device behavior are implemented and reviewed. TLS alone is not E2EE.

## Privacy and telemetry

PCR telemetry should remain local to the call unless a documented support/diagnostic flow explicitly opts in. Do not expose raw network statistics to other participants. If diagnostic storage is later introduced, document the purpose, fields, access controls, retention, and deletion path first.

## Known gaps

Email verification, account recovery, CSRF token/Origin validation, explicit CORS policy, distributed rate limiting, linked-device/session listing and revocation, session renewal, upload security, audit logging, retention, and E2EE are not implemented. SameSite=Strict cookies and JSON-only state-changing routes are baseline CSRF mitigations, not a complete CSRF review. Dependency audit reports zero known advisories at the last run, but no penetration or full application security test has been run. No production security claim is made.