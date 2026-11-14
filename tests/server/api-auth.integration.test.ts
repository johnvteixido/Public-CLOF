import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

const PASSWORD = "correct-horse-battery-staple";
const SECRET = "b".repeat(64);

let server: Server;
let baseUrl = "";
let sessionCookie = "";
let csrfToken = "";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

describe("Express API authentication integration", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ACCESS_PASSWORD = PASSWORD;
    process.env.APP_SESSION_SECRET = SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL_UNPOOLED;

    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Could not reserve an integration test port.");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => error ? reject(error) : resolve()),
    );

    baseUrl = `http://127.0.0.1:${port}`;
    process.env.APP_URL = baseUrl;

    const { default: app } = await import("../../server");
    server = app.listen(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    delete process.env.APP_ACCESS_PASSWORD;
    delete process.env.APP_SESSION_SECRET;
    delete process.env.APP_URL;
    delete process.env.NODE_ENV;
  });

  it("keeps health status public while omitting raw database errors", async () => {
    const response = await request("/api/health");
    expect([200, 503]).toContain(response.status);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toHaveProperty("authentication", "configured");
    expect(body).not.toHaveProperty("dbError");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("blocks business data routes before authentication", async () => {
    const leads = await request("/api/leads");
    const profile = await request("/api/profile");
    expect(leads.status).toBe(401);
    expect(profile.status).toBe(401);
    expect(await leads.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("rejects cross-origin and incorrect-password sign-in attempts", async () => {
    const crossOrigin = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(crossOrigin.status).toBe(403);

    const incorrect = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(incorrect.status).toBe(401);
  });

  it("creates an HttpOnly session for the correct owner password", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { configured: boolean; authenticated: boolean; csrfToken: string };
    expect(body.configured).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.csrfToken).toBeTypeOf("string");
    csrfToken = body.csrfToken;
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    sessionCookie = setCookie!.split(";")[0]!;
  });

  it("allows the authenticated session through the auth layer", async () => {
    const response = await request("/api/leads", {
      headers: { cookie: sessionCookie },
    });
    // No database is configured in this test. A 503 proves auth passed and
    // the route reached its database dependency rather than returning 401.
    expect(response.status).toBe(503);
  });

  it("rejects state changes without CSRF proof or from a foreign origin", async () => {
    const missingCsrf = await request("/api/leads", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({ name: "Should never be inserted" }),
    });
    expect(missingCsrf.status).toBe(403);

    const foreignOrigin = await request("/api/leads", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        origin: "https://attacker.example",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ name: "Should never be inserted" }),
    });
    expect(foreignOrigin.status).toBe(403);
  });

  it("accepts CSRF proof and reaches the database boundary", async () => {
    const response = await request("/api/leads", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        origin: baseUrl,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ name: "Database is intentionally unavailable" }),
    });
    expect(response.status).toBe(503);
  });

  it("rejects malformed AI generation inputs before invoking providers", async () => {
    const missingFields = await request("/api/generate-leads", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: baseUrl,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ industry: " ", location: "Tampa" }),
    });
    expect(missingFields.status).toBe(400);

    const oversizedIndustry = await request("/api/generate-leads", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: baseUrl,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ industry: "x".repeat(161), location: "Tampa" }),
    });
    expect(oversizedIndustry.status).toBe(400);

    const invalidCompanyName = await request("/api/generate-pitch-strategy", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: baseUrl,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ companyName: 42 }),
    });
    expect(invalidCompanyName.status).toBe(400);
  });

  it("expires the browser session on sign-out", async () => {
    const response = await request("/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: baseUrl,
        "x-csrf-token": csrfToken,
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("teixido_session=;");
    // Browsers discard the cookie because the response expires it. A previously
    // copied token remains valid until expiry; this stateless session format
    // does not provide per-token server-side revocation.
    const blocked = await request("/api/leads");
    expect(blocked.status).toBe(401);
  });
});
