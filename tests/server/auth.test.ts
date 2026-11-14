import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  createSession,
  isAuthConfigured,
  readSessionToken,
  requireAuth,
  requireCsrf,
  requireSameOrigin,
  setSessionCookie,
  SESSION_TTL_MS,
  verifyAccessPassword,
} from "../../src/server/auth";

const PASSWORD = "correct-horse-battery-staple";
const SECRET = "a".repeat(64);
const ORIGIN = "https://workspace.example";

function makeReq(
  headers: Record<string, string | undefined> = {},
  cookies: Record<string, string> = {},
): Request {
  return {
    headers,
    cookies,
    get: (name: string) => headers[name.toLowerCase()],
    secure: ORIGIN.startsWith("https:"),
  } as unknown as Request;
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  return {
    res: { status, json, cookie, clearCookie } as unknown as Response,
    status,
    json,
    cookie,
    clearCookie,
  };
}

beforeEach(() => {
  vi.stubEnv("APP_ACCESS_PASSWORD", PASSWORD);
  vi.stubEnv("APP_SESSION_SECRET", SECRET);
  vi.stubEnv("APP_URL", ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("owner session authentication", () => {
  it("fails closed when any required authentication setting is missing", () => {
    delete process.env.APP_ACCESS_PASSWORD;
    expect(isAuthConfigured()).toBe(false);
    expect(verifyAccessPassword(PASSWORD)).toBe(false);
    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    requireAuth(makeReq(), res, next);
    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("requires HTTPS for a production application origin", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "http://workspace.example";
    expect(isAuthConfigured()).toBe(false);
    process.env.APP_URL = ORIGIN;
    expect(isAuthConfigured()).toBe(true);
  });

  it("requires a strong-enough server configuration", () => {
    process.env.APP_ACCESS_PASSWORD = "short";
    expect(isAuthConfigured()).toBe(false);
    process.env.APP_ACCESS_PASSWORD = PASSWORD;
    process.env.APP_SESSION_SECRET = "short";
    expect(isAuthConfigured()).toBe(false);
  });

  it("compares the supplied password without comparing variable-length strings", () => {
    expect(verifyAccessPassword(PASSWORD)).toBe(true);
    expect(verifyAccessPassword("incorrect")).toBe(false);
    expect(verifyAccessPassword(undefined)).toBe(false);
  });

  it("issues a signed session and rejects a modified token", () => {
    const session = createSession();
    expect(readSessionToken(session.token)).toEqual({
      expiresAt: session.expiresAt,
      csrfToken: session.csrfToken,
    });
    expect(readSessionToken(session.token + "x")).toBeNull();
    expect(readSessionToken("not-a-session")).toBeNull();
  });

  it("rejects expired and oversized session tokens", () => {
    const session = createSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1);
    expect(readSessionToken(session.token)).toBeNull();
    vi.useRealTimers();
    expect(readSessionToken("x".repeat(2049))).toBeNull();
  });

  it("invalidates existing sessions when the signing secret rotates", () => {
    const session = createSession();
    process.env.APP_SESSION_SECRET = "c".repeat(64);
    expect(readSessionToken(session.token)).toBeNull();
  });

  it("sets an HttpOnly, SameSite=Lax cookie with the expected lifetime", () => {
    const session = createSession();
    const { res, cookie } = makeRes();
    setSessionCookie(res, makeReq(), session.token);
    expect(cookie).toHaveBeenCalledWith(
      "teixido_session",
      session.token,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 12 * 60 * 60 * 1000,
      }),
    );
  });

  it("rejects requests without a valid owner session", () => {
    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    requireAuth(makeReq(), res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a request with a valid signed owner session", () => {
    const session = createSession();
    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    requireAuth(makeReq({}, { teixido_session: session.token }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect CSRF tokens", () => {
    const session = createSession();
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;
    requireCsrf(makeReq({ origin: ORIGIN }, { teixido_session: session.token }), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("requires both the session CSRF token and the exact configured origin", () => {
    const session = createSession();
    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    requireCsrf(
      makeReq({ origin: ORIGIN, "x-csrf-token": session.csrfToken }, { teixido_session: session.token }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request even when it carries a valid session", () => {
    const session = createSession();
    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    requireSameOrigin(
      makeReq({ origin: "https://attacker.example" }, { teixido_session: session.token }),
      res,
      next,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
