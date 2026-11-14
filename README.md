# Client Lead & Outreach Finder

An owner-operated prospecting workspace for discovering businesses, reviewing public contact evidence, managing a local lead pipeline, and preparing personalized outreach drafts. Gmail sending is optional and requires a separate Google OAuth connection.

This is a single-owner application, not a multi-tenant CRM or general-purpose lead database.

## Product capabilities

- Discover companies by industry, location, size, and technical focus using Gemini with Google Search grounding.
- Research public business websites for page text, contact email candidates, and phone numbers. Discovery sources are retained for review.
- Prepare email, SMS, cold-call, voicemail, and pitch-strategy drafts. These remain drafts for human review; the application does not automatically call or text prospects.
- Manage the pipeline with status, notes, contact details, and editable templates.
- Send optional email through the connected Gmail account after the owner explicitly initiates sending. The sender validates message headers and requires a configured sender postal address before sending; it does not certify legal compliance.
- View leads on an offline SVG radar using a small static city-coordinate table.

Contact details extracted from a public website are candidates, not proof that an address is deliverable or that a person has consented to receive outreach. Verify details and follow applicable laws and platform policies before contacting anyone.

## Architecture

The application is organized as a browser UI, a server-side API, domain services, and a persistence layer.

    React 19 + Vite + Tailwind
            |
            | same-origin requests, signed session cookie
            v
    Express API (server.ts)
            |
            +--> Authentication / CSRF / rate limiting
            |
            +--> Lead pipeline
            |      +--> Gemini + Google Search grounding
            |      +--> Public website fetcher (DNS-pinned egress)
            |      +--> Email verification adapter
            |      +--> Vercel AI Gateway for draft generation
            |
            +--> Gmail service (OAuth 2.0; encrypted refresh token)
            |
            v
    Neon PostgreSQL

### Important design decisions

1. The server is authoritative for business data and integrations. Database credentials, Gemini credentials, AI Gateway credentials, Gmail client secrets, and encryption keys remain server-side.
2. Owner-only sessions replace browser-shipped secrets. The application uses a server-configured password, HMAC-signed session cookie, and per-session CSRF token. No VITE_ authentication secret is used.
3. Mutation requests are same-origin and CSRF-protected. The server validates the configured origin and requires the session CSRF token for state-changing API calls.
4. Website research has controlled egress. Only HTTP(S) URLs on standard web ports are eligible. Literal IPs and local hostnames are rejected. DNS results are checked for public routability and pinned into the connection lookup. Redirects are handled manually and every hop is revalidated.
5. The Neon adapter is intentionally narrow. src/server/db.ts exposes the small query-builder surface used by this application. It is not a drop-in implementation of the full Supabase client.
6. AI-generated content is advisory. Generated observations and outreach text remain reviewable drafts. Model output must not be represented as independently verified fact.

See [docs/architecture.md](docs/architecture.md), [docs/security-model.md](docs/security-model.md), the [reviewer guide](docs/reviewer-guide.md), and the [Alignerr submission notes](docs/alignerr-submission.md) for detailed explanations and a guided code tour.

## Reviewer quick tour

A useful first pass is to read the architecture overview, inspect the authentication and scraper boundaries, then run the automated checks. The reviewer guide maps each engineering claim to its implementation and tests. The repository intentionally documents the limits of its single-owner design rather than presenting it as a multi-tenant or independently audited product.

## Local development (Windows PowerShell)

Requirements: Node.js 22.23.4 or newer and npm.

    npm ci
    Copy-Item .env.example .env.local

Edit .env.local and set:

- APP_URL=http://localhost:3000
- APP_ACCESS_PASSWORD to a unique password at least 16 characters long
- APP_SESSION_SECRET to at least 32 random characters
- DATABASE_URL to a Neon PostgreSQL connection string if persistence is needed
- GEMINI_API_KEY for grounded company discovery
- AI_GATEWAY_API_KEY when local Vercel OIDC is unavailable
- Gmail OAuth variables only if you intend to enable email sending

Generate a session secret in PowerShell:

    node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

Start the application:

    npm run dev

Open http://localhost:3000 and sign in with APP_ACCESS_PASSWORD.

## Validation commands

    npm run lint
    npm run lint:eslint
    npm test
    npm run build

CI runs these checks on pull requests and pushes to main. Integration tests exercise the Express authentication and authorization boundary with a real local HTTP server; they do not require a live Neon, Gemini, Gmail, or Vercel account.

## Environment variables

See .env.example for the complete environment contract. All credentials must be configured as server-side environment variables. Do not add VITE_ prefixes to secrets. The old APP_SHARED_SECRET and VITE_APP_SHARED_SECRET settings are no longer supported.

For Vercel, configure APP_URL to the exact production origin and set APP_ACCESS_PASSWORD and APP_SESSION_SECRET in the appropriate environments. The production cookie is Secure when NODE_ENV=production.

## Security and operating boundaries

- Single-owner password authentication; no user registration, account recovery, roles, or multi-tenant isolation.
- Sessions last 12 hours and are signed with HMAC-SHA-256. The cookie is HttpOnly, SameSite=Lax, and Secure in production.
- CSRF and strict configured-origin checks protect mutating API routes.
- Baseline HTTP headers prevent MIME sniffing and framing, API responses are not cacheable, and production responses use HSTS. A Content Security Policy remains a future hardening item pending a full asset-source audit.
- Login and API rate limits are in-memory and therefore per running server instance. They are useful abuse controls, not a distributed rate-limiting service.
- The browser keeps a local cache in localStorage. It is not encrypted and is accessible to users with access to that browser profile/device.
- Website fetching limits redirects, response types, response sizes, and time. DNS resolution is pinned to validated public addresses for each request.
- Gmail sends and database logging cannot be made one atomic transaction with the current integration. A successful send followed by a database failure may require manual reconciliation.
- This repository has not undergone an independent penetration test or formal security audit. Do not treat these controls as a certification or guarantee of safety.

## Deployment

The Vercel API entry point loads the bundled Express server from dist/server.cjs. Build with npm run build; Vercel should run the configured build command and use the repository's Node engine requirement.

Before enabling Gmail sending in production, configure the Google OAuth redirect URI as APP_URL/api/auth/callback, restrict the OAuth consent configuration appropriately, and set the token-encryption key. Do not enable sending until the owner has reviewed the recipient, subject, and message body.

## Project status

This is an actively developed personal application. The architecture and controls above describe the intended current implementation; automated checks should be run on the exact revision being evaluated. See the issue tracker and commit history for ongoing work.
