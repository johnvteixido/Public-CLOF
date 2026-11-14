# Architecture and implementation guide

## Runtime composition

### Browser application

- React owns view state and user interactions.
- Vite builds the static client and provides development middleware.
- src/lib/api.ts centralizes same-origin API requests, session state, and CSRF headers.
- The UI uses a browser-local cache for leads and profile values to preserve a useful view when the API is temporarily unavailable. That cache is not a secure storage boundary.

### Express application

server.ts composes middleware and routes. Middleware order is intentional:

1. Configure the trusted proxy boundary.
2. Configure CORS for the one configured application origin.
3. Parse bounded JSON bodies and cookies.
4. Attach request logging.
5. Apply authentication, CSRF, and rate limiting at the relevant route.
6. Execute domain services and return normalized responses.

The health route is intentionally unauthenticated and returns only coarse service status. Business data and operational routes require an authenticated owner session.

### Domain services

- src/server/leadPipeline.ts coordinates discovery, website research, contact extraction, personalization, and final lead shaping.
- src/server/gemini.ts performs grounded discovery and model-assisted draft generation.
- src/server/scrape.ts retrieves bounded public web pages and extracts text, email candidates, and phone candidates.
- src/server/verifyEmail.ts provides the current email verification strategy.
- src/server/gmail.ts handles Google OAuth, encrypted refresh-token retrieval, message construction, suppression checks, and sending.
- src/server/crypto.ts encrypts stored refresh tokens with AES-256-GCM.
- src/server/db.ts provides a deliberately small query-builder adapter on top of Neon PostgreSQL.

## Data flow

### Lead discovery

1. An authenticated owner submits industry, location, scale, and technology filters.
2. The server requests grounded company candidates from Gemini/Google Search.
3. Candidate websites are validated before retrieval. Fetches are limited to five candidate pages per website, three successful pages, 200 KB per page, five seconds per website, and three redirects per request.
4. The pipeline extracts public contact candidates, then asks the writing model for draft outreach.
5. The server returns candidate leads and grounding sources. The owner can review and selectively save leads to Neon.

### Email sending

1. The owner explicitly triggers a send for a saved lead.
2. The server checks the suppression list and daily cap.
3. The server decrypts the stored Gmail refresh token and obtains an authorized Gmail client.
4. The message includes the owner's configured signature and opt-out text.
5. The Gmail API sends the message; a send record is written to Neon and the lead status is updated best-effort.

This is a single-owner workflow. Gmail OAuth authenticates the owner's Gmail account; it is separate from application sign-in.

## Database bootstrap and permissions

The Neon adapter lazily initializes its schema on the first database operation in a server instance. It creates the pgcrypto extension, creates the profile/leads/sends/suppressions tables, applies additive column changes, creates indexes, and seeds the singleton profile when its fields are empty. This keeps the single-owner prototype easy to provision, but it means the application database role needs the required DDL permissions at first use. For a stricter production deployment, move these statements into a versioned migration job and run the web application with a least-privilege DML role.

## Why the database adapter exists

The browser and server code originally used a Supabase-like .from(...) query interface. The current persistence provider is Neon. Rather than spread raw SQL through route handlers, db.ts implements the small set of query operations the application needs and translates them into parameterized Neon queries.

It is not the Supabase SDK and does not implement the full PostgREST API. Query identifiers are validated and values are bound parameters. Additions to this adapter should come with tests for identifier validation, empty updates, filters, and generated SQL behavior.

## Why the application has a CLI-free server boundary

The deployed server is built to dist/server.cjs, then loaded from the Vercel API entry point. This avoids Vercel's runtime failing to resolve extensionless ESM imports from the source server. Local development runs the same Express routes with Vite middleware attached.
