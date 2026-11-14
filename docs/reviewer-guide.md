# Engineering reviewer guide

## What this project is

Client Lead & Outreach Finder is a single-owner prospecting application. It combines grounded business discovery, bounded public-website research, a local lead pipeline, draft generation, and optional owner-initiated Gmail delivery.

The important engineering work is not just the UI. The application crosses several trust boundaries: browser-to-server authentication, untrusted URLs fetched by a server, model-produced text, database persistence, and an external email provider. The design and tests focus on those boundaries. The public repository is a source-only snapshot; its history does not contain the original private development commits.

This guide describes the implementation as it exists in this repository. It is not a security certification, a live-service guarantee, or a claim that every external integration has been tested against production credentials.

## Code tour

| Area | Primary files | What to inspect |
| --- | --- | --- |
| Browser app and API client | `src/App.tsx`, `src/lib/api.ts` | Session initialization, same-origin requests, CSRF header handling, local cache behavior |
| HTTP composition | `server.ts` | Middleware order, route guards, input limits, response headers, route behavior |
| Authentication | `src/server/auth.ts` | Password verification, HMAC session format, expiry checks, HttpOnly cookie, CSRF and origin checks |
| Lead workflow | `src/server/leadPipeline.ts`, `src/server/gemini.ts` | Grounded discovery and the boundary between evidence and generated suggestions |
| Website retrieval | `src/server/scrape.ts` | URL validation, public DNS resolution, DNS pinning, redirect revalidation, response bounds |
| Persistence | `src/server/db.ts` | Identifier validation, bound SQL values, lazy schema bootstrap, narrow query-builder adapter |
| Gmail integration | `src/server/gmail.ts`, `src/server/crypto.ts` | OAuth token persistence, AES-256-GCM encryption, suppression checks, sending and logging |
| Automated tests | `tests/server/` | Auth unit and HTTP integration tests, scraper tests, DB adapter tests, crypto and Gmail configuration tests |

## Suggested review sequence

1. Start with `README.md` and `docs/architecture.md` to understand the runtime shape.
2. Read `src/server/auth.ts` and then the authentication routes in `server.ts`. Follow a login request through session creation, cookie delivery, authenticated reads, and CSRF-protected writes.
3. Inspect `src/server/scrape.ts`. Treat the requested website as attacker-controlled input. Follow URL validation, DNS lookup, the pinned dispatcher, redirect handling, response type checking, body-size limits, and timeout behavior.
4. Read `src/server/db.ts` alongside `tests/server/db.test.ts`. The adapter deliberately supports only the query operations used by this application; it is not a general Supabase/PostgREST replacement.
5. Follow the Gmail path through `src/server/gmail.ts` and `src/server/crypto.ts`. Pay particular attention to token encryption, suppression checks, the daily cap, and the non-atomic boundary between Gmail and database writes.
6. Run the validation commands below and inspect the current GitHub Actions result for the exact commit being reviewed.

## Local setup and validation

Requirements: Node.js 22.23.4 or newer and npm.

On Windows PowerShell:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Set the required local authentication values in `.env.local`:

- `APP_URL=http://localhost:3000`
- `APP_ACCESS_PASSWORD`: unique password, at least 16 characters
- `APP_SESSION_SECRET`: random value, at least 32 characters

Optional integrations need their own server-side configuration:

- `DATABASE_URL` for Neon persistence
- `GEMINI_API_KEY` for grounded business discovery
- `AI_GATEWAY_API_KEY` (or an appropriate Vercel OIDC token in Vercel) for AI drafting
- Google OAuth client values and `GMAIL_TOKEN_ENCRYPTION_KEY` for Gmail sending

Then run:

```powershell
npm run dev
```

Open `http://localhost:3000`. Without database or provider credentials, the application can still be started and the authentication boundary can be inspected, but the corresponding integration features will be unavailable.

Run the same checks used by CI:

```powershell
npm run lint
npm run lint:eslint
npm test
npm run build
```

The HTTP integration tests start a local Express server and exercise authentication, route authorization, origin/CSRF behavior, logout, validation, and response headers. They do not require live Neon, Gemini, Vercel, or Gmail accounts.

## Design trade-offs worth discussing

### Stateless sessions

HMAC-signed sessions avoid a session database for this single-owner deployment. The trade-off is that logout expires the current browser cookie but cannot revoke a copied token before its 12-hour expiry. Rotating `APP_SESSION_SECRET` invalidates every session. A shared session store is the next step if immediate revocation or multiple application instances need coordinated session state.

### Per-instance rate limiting

The in-memory login and API limiters are simple abuse controls, not a distributed security boundary. Vercel serverless instances do not share these maps. A shared atomic rate-limit store or hosting-layer control is needed for stronger global enforcement.

### Scraper SSRF controls

The scraper does not rely only on string checks. It resolves candidate hostnames, rejects non-public addresses, pins validated addresses for the connection, disables automatic redirects, and revalidates every redirect. Outbound network policy at the host remains a valuable additional defense.

### Narrow database adapter

The small adapter keeps SQL construction in one place and binds values rather than concatenating user data. It intentionally does not try to reproduce every Supabase query feature. A future migration should move schema DDL out of request-time startup and run the web process with a least-privilege database role.

### Human review for outbound communication

AI text and extracted contacts are candidates for owner review, not verified facts or consent. Calls and texts are not initiated automatically. The email path requires an explicit owner action, validates sender and recipient addresses, rejects control characters in RFC 822 headers, and blocks sending when no sender postal address has been configured. It adds an opt-out instruction to the message footer. These controls do not certify legal compliance or verify that the supplied postal address is accurate.

The Gmail daily cap is not an atomic distributed reservation and Gmail delivery cannot be committed atomically with the database log.

## Known limitations

- Single-owner authentication only. There is no registration, password recovery, role system, per-tenant data isolation, or record ownership model.
- Session revocation and rate limits are process-local/stateless as described above.
- Browser cache values are stored in `localStorage` and are not encrypted.
- Schema bootstrap still requires DDL privileges on first use; versioned migrations and a least-privilege runtime account are preferable.
- Concurrent Gmail sends can exceed the daily cap because reservation is not atomic across instances.
- A successful Gmail send followed by a database logging failure can require reconciliation.
- A Content Security Policy has not been added pending a full asset-source audit.
- The full development dependency tree has six known moderate advisories in the TypeScript-ESLint/minimatch dependency chain at the time of the documented audit. Production dependencies have no advisories at the configured moderate threshold; CI gates the full tree for high and critical advisories.
- No independent penetration test or formal security certification has been performed.

For detailed threat-boundary notes, see [security-model.md](security-model.md). For component relationships and data flow, see [architecture.md](architecture.md).
