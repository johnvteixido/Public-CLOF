# Security model and known limitations

## HTTP response protections

The Express application sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict cross-origin referrer policy, and a restrictive permissions policy. API responses are marked `Cache-Control: no-store`; production responses receive HSTS. A Content Security Policy has not yet been introduced because the frontend's complete asset and integration source requirements have not been audited.

## Authentication

The application is single-owner. Production APP_URL must be an HTTPS origin; local development may use HTTP. Authentication configuration fails closed if the URL is malformed or contains a path, query, or fragment.

The server requires:

- APP_ACCESS_PASSWORD: a unique password of at least 16 characters.
- APP_SESSION_SECRET: a random secret of at least 32 characters used for HMAC signing.
- APP_URL: the exact browser origin used for same-origin checks.

Login is limited to five attempts per IP in a rolling 15-minute window per server instance. The session token parser also rejects oversized token values before attempting signature verification.

A successful sign-in creates a 12-hour session token. The token is an HMAC-SHA-256 signature over an expiry and random CSRF token. It is stored in an HttpOnly, SameSite=Lax cookie, marked Secure in production. No password or session secret is embedded in the browser bundle.

Sessions are stateless. Logout expires the cookie in the current browser, but cannot revoke a previously copied token before its expiry. Rotating APP_SESSION_SECRET invalidates every existing session. A shared session store would be required for immediate per-session revocation across serverless instances.

All data and integration routes require a valid session. Mutating routes additionally require the session CSRF token in X-CSRF-Token and an exact matching Origin header. The login endpoint is also origin-checked and rate-limited.

## Scraper egress controls

The scraper treats discovered website URLs as untrusted input. It:

- accepts only HTTP and HTTPS;
- allows only protocol-matched default ports (HTTP on 80 and HTTPS on 443);
- rejects credentials in URLs, IP-literal hosts, and local/test/internal hostnames;
- resolves DNS before connecting and rejects non-public addresses;
- pins the connection's DNS lookup to the validated address set;
- disables automatic redirects and revalidates every redirect target;
- caps redirects, response size, content type, and elapsed time.

These controls reduce SSRF exposure. They do not make the scraper a general-purpose network sandbox; keep it server-side and continue to restrict outbound networking at the hosting layer where possible.

## Token protection

Gmail refresh tokens are encrypted at rest with AES-256-GCM. The encryption key is a server-only 32-byte hex value in GMAIL_TOKEN_ENCRYPTION_KEY. Losing this key makes existing encrypted tokens unreadable; rotating it requires a planned token re-encryption or Gmail reconnection.

## Outbound email boundary

The Gmail sender validates recipient and sender email addresses and rejects control characters in recipient, sender display-name, and subject headers before constructing the RFC 822 message. Non-ASCII display names and subjects are encoded as MIME encoded words. Commercial sends are blocked when the owner profile has no postal address, and the footer includes an opt-out instruction.

The application only checks that the postal-address field is non-empty. It does not verify the address, determine whether a particular message is legally commercial, or provide a legal compliance review. Owners remain responsible for accurate sender identity, a valid postal address, honoring opt-out requests, recipient eligibility, and applicable law and provider policy.

## Rate limits and deployment caveats

Rate limits are process-local. Serverless platforms can run multiple isolated instances, so these limits are not a distributed quota or a defense against a determined distributed attack. Consider a shared rate-limit store or hosting-layer firewall for broader exposure.

The app's localStorage cache is not encrypted. Device/browser-profile access is outside the server session boundary. The application is single-owner and has no multi-tenant authorization or per-record ownership model.

Database schema setup currently runs from the application on first use and needs DDL privileges for the required tables, columns, indexes, and pgcrypto extension. This is convenient for personal provisioning but is not the preferred least-privilege production migration model. The Gmail daily-send cap is also a read-then-send-then-record workflow, not an atomic distributed reservation; concurrent sends across serverless instances can exceed the configured cap. A shared transactional quota ledger is needed before treating the cap as a hard global limit.

## Dependency audit snapshot (November 14, 2026)

The repository's CI runs `npm audit --omit=dev --audit-level=moderate` and `npm audit --audit-level=high`. The reviewed lockfile has no production dependency advisories at the moderate threshold and no high or critical findings across the full dependency tree. The development tree resolves `minimatch@10.2.6` through `@typescript-eslint/typescript-estree@8.72.2`, whose published dependency range is `^10.2.2`. GitHub advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) affects `minimatch` versions from 7.0.0 through versions before 11.0.1; the current npm release is 11.0.8. A scoped override to the new major has not been applied because it is outside the upstream TypeScript-ESLint range and must be verified against the full lint/test toolchain before adoption. This is a development/build-tool dependency, not part of the production runtime dependency tree. Recheck the upstream range and advisory status during dependency maintenance.

## Operational checklist

- Use a unique, high-entropy application password.
- Generate a random session secret; never reuse database, Gmail, or API keys.
- Set APP_URL to the exact deployed origin.
- Keep all secrets out of VITE_* variables, source control, logs, and screenshots.
- Restrict database access and use a dedicated database role with only required privileges.
- Configure the hosting platform to limit outbound access if possible.
- Rotate the Gmail encryption key only with a migration plan.
- Review each outreach message manually.
- Run dependency and security updates regularly.

The repository has not been independently penetration-tested. These measures are defense-in-depth controls, not a security certification.
