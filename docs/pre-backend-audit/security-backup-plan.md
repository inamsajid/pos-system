# Security, Privacy, Backup and Recovery Plan

## Current findings

- Authentication screens are non-functional and ProtectedRoute always allows access. Every business route is effectively public to anyone who can open the frontend.
- No business membership, branch scope, role model, session handling or authorization checks exist.
- api-client.ts has no auth token/session policy, schema validation, request timeout or CSRF policy; it is currently unused.
- .env.local is covered by the *.local ignore rule and .env.example contains only a public API base URL placeholder. A static source scan found no obvious API secret constants. VITE_ values are public bundle configuration and must never contain secrets.
- Product image input accepts image/* and says it remains in browser session; there is no upload endpoint or file persistence policy.
- Customer/supplier mock fixtures include personal-like contact fields; do not use production personal data in these fixtures.
- localStorage records are unencrypted, origin-readable and editable by browser users. They are demo data, not protected records and not backed up.

## Requirements before production data

### Authentication and authorization
- Use a reviewed session model (secure, HttpOnly, SameSite cookies preferred for browser session; CSRF defense for cookie-authenticated mutations).
- Validate identity and membership on every API request. Bind business/branch and role from the server-side session.
- Roles to define with least privilege: owner, admin, manager, cashier, inventory manager, accountant. Specify actions per role; do not infer authorization from hidden UI buttons.
- Enforce business isolation in every query and FK relationship. Add audit entries for role, membership, financial and inventory actions.
- Rate-limit login, password reset, receipt/payment writes and sensitive exports; protect against brute force and replay.

### Validation and sensitive data
- Validate all request fields on the Worker, including relationships, money, quantity, dates, status transitions, image size/type and business scope. UI validation is only usability support.
- Use prepared D1 statements and bound parameters; avoid string-built SQL.
- Never log credentials, payment references with sensitive contents, full customer data or auth tokens. Redact structured telemetry.
- Treat R2 object keys as private; use scoped short-lived upload/download authorization, content-type and size checks, malware policy as appropriate, and ownership checks.
- Secure CORS to known frontend origins; define CSP, secure headers, CSRF, session expiry/revocation and token rotation.
- Remove hard-coded employee/business names from transactions; use authenticated actor and business settings.

## Backup and recovery

1. Enable/retain D1 backups or point-in-time recovery available for the chosen Cloudflare plan and document retention guarantees before production.
2. Produce separate encrypted off-site exports on a schedule; protect encryption keys independently from backups.
3. Back up R2 objects and maintain a manifest mapping object to business/entity. Use versioning/retention or periodic cross-account/off-site copies if available.
4. Keep transaction/ledger/stock movement audit history append-only. A backup does not replace audit history.
5. Define RPO/RTO by business needs, retention/deletion/legal policy, and ownership for restore approval.
6. Test restore into an isolated environment on a schedule; verify row counts, FK integrity, ledger reconciliation, stock movement-to-balance reconciliation, invoice totals and sample file hashes.
7. Document incident response and customer/business notification policy.

No backup is currently configured for browser localStorage, and it must not be represented as a backup. Cloudflare features and plan guarantees are time-sensitive; verify official documentation and selected plan at implementation time.

