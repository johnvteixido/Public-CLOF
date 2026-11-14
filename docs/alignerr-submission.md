# Alignerr submission notes

## Project summary

Client Lead & Outreach Finder is a single-owner prospecting workspace built with React, TypeScript, Express, Vite, and Neon PostgreSQL. It combines grounded business discovery, bounded public-website research, a persistent lead pipeline, AI-assisted outreach drafts, and optional owner-initiated Gmail sending.

The engineering review should focus on the trust boundaries rather than only the UI: browser-to-server authentication, untrusted URL retrieval, generated content versus source evidence, parameterized persistence, and third-party OAuth/email integration.

## Recommended reviewer path

1. Read [README.md](../README.md) for capabilities, setup, and operational boundaries.
2. Review the [engineering roadmap](roadmap.md), [open GitHub issues](https://github.com/johnvteixido/Public-CLOF/issues), and [Actions history](https://github.com/johnvteixido/Public-CLOF/actions) for tracked follow-up work and verifiable development activity. Roadmap issues are explicitly planned until implementation, tests, and CI are complete.
3. Read [docs/architecture.md](architecture.md) for the component and data flow.
3. Follow authentication in `src/server/auth.ts` and its Express integration in `server.ts`.
4. Review SSRF-resistant retrieval in `src/server/scrape.ts`.
5. Review the narrow Neon query adapter in `src/server/db.ts`.
6. Review Gmail token protection in `src/server/crypto.ts` and `src/server/gmail.ts`.
7. Inspect `tests/server/` and run the commands in the reviewer guide.

## Reproduce the checks

Requirements: Node.js 22.23.4 or newer and npm.

```powershell
npm ci
npm run lint
npm run lint:eslint
npm test
npm run build
```

The initial public source snapshot passed GitHub Actions run [#43616369083](https://github.com/johnvteixido/Public-CLOF/actions/runs/43616369083) on November 14, 2026. The subsequent roadmap update was merged through public PR [#6](https://github.com/johnvteixido/Public-CLOF/pull/6), and the resulting `main` commit passed run [#43617984491](https://github.com/johnvteixido/Public-CLOF/actions/runs/43617984491). The checks include `npm ci`, both dependency-audit gates, TypeScript, ESLint, **52 tests across 7 files**, and the production build. These runs are attached to the public repository, not just the private development PR.

## Public source mirror

The project is published at [johnvteixido/Public-CLOF](https://github.com/johnvteixido/Public-CLOF). This is a source-only snapshot of the hardened implementation. It was created in a new, empty repository and does not include the commit history of the original private repository.

The original development repository remains private because its historical commits include owner-specific profile and outreach material that was removed from the hardened source. The public mirror contains the reviewed source snapshot and its own fresh history. The original private repository was not made public.

The public snapshot was checked for remaining owner-specific profile defaults, obvious credentials, and personal contact details. Gitleaks and automated secret scanning are useful additional checks, but they cannot prove the absence of every form of personal information.

## Hosted preview

There is no public hosted demo in this submission. The current Vercel deployment is a Preview deployment protected by Vercel SSO, not a production deployment. Production activation is intentionally separate: the new owner-authentication configuration requires a unique `APP_ACCESS_PASSWORD` and random `APP_SESSION_SECRET`, and a public preview should use an isolated review database rather than the production database.

Review the source locally using the setup steps above. Do not treat the protected preview URL as a public reviewer link.

## Known limitations

- Single-owner authentication only; no registration, recovery, roles, or multi-tenant data isolation.
- Stateless sessions cannot revoke a copied token before expiry.
- Rate limits are per server instance, not distributed.
- Browser cache data is stored in unencrypted `localStorage`.
- Schema bootstrap currently requires DDL privileges; versioned migrations and a least-privilege runtime role are recommended.
- Gmail sends and database logging are not one atomic transaction, and the daily send cap is not an atomic distributed reservation.
- The Gmail path validates sender and recipient addresses, rejects CRLF/control characters in message headers, and blocks sends without a configured postal address. The owner must supply an accurate address; the application does not certify legal compliance.
- A Content Security Policy and independent penetration test remain future work.
- The development dependency tree has a documented moderate `minimatch` advisory; see [docs/security-model.md](security-model.md).
