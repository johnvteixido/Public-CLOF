import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const SESSION_COOKIE_NAME = "teixido_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AppSession {
  expiresAt: number;
  csrfToken: string;
}

function appOrigin(): string | null {
  const configured = process.env.APP_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAuthConfigured(): boolean {
  const password = process.env.APP_ACCESS_PASSWORD ?? "";
  const secret = process.env.APP_SESSION_SECRET ?? "";
  return password.length >= 16 && secret.length >= 32 && appOrigin() !== null;
}

function signature(payload: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(payload).digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyAccessPassword(candidate: unknown): boolean {
  if (!isAuthConfigured() || typeof candidate !== "string") return false;
  const expected = crypto.createHash("sha256").update(process.env.APP_ACCESS_PASSWORD!).digest();
  const actual = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(): { token: string; csrfToken: string; expiresAt: number } {
  if (!isAuthConfigured()) throw new Error("Application authentication is not configured.");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ expiresAt, csrfToken } satisfies AppSession)).toString("base64url");
  const token = `${payload}.${signature(payload, process.env.APP_SESSION_SECRET!).toString("base64url")}`;
  return { token, csrfToken, expiresAt };
}

export function readSessionToken(token: unknown): AppSession | null {
  if (!isAuthConfigured() || typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) return null;

  const expected = signature(payload, process.env.APP_SESSION_SECRET!);
  let actual: Buffer;
  try {
    actual = Buffer.from(providedSignature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AppSession>;
    if (
      typeof decoded.expiresAt !== "number" ||
      decoded.expiresAt <= Date.now() ||
      typeof decoded.csrfToken !== "string" ||
      decoded.csrfToken.length < 32
    ) return null;
    return { expiresAt: decoded.expiresAt, csrfToken: decoded.csrfToken };
  } catch {
    return null;
  }
}

export function sessionFromRequest(req: Request): AppSession | null {
  return readSessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
}

export function setSessionCookie(res: Response, req: Request, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, req: Request): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax",
    path: "/",
  });
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const expectedOrigin = appOrigin();
  const suppliedOrigin = req.get("origin");
  if (!expectedOrigin || !suppliedOrigin || suppliedOrigin !== expectedOrigin) {
    res.status(403).json({ error: "Request origin is not allowed.", code: "origin_rejected" });
    return;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "Application authentication is not configured.", code: "auth_not_configured" });
    return;
  }
  if (!sessionFromRequest(req)) {
    res.status(401).json({ error: "Authentication required.", code: "unauthenticated" });
    return;
  }
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const session = sessionFromRequest(req);
  const provided = req.get("x-csrf-token");
  if (!session || !provided || !constantTimeEqual(provided, session.csrfToken)) {
    res.status(403).json({ error: "CSRF validation failed.", code: "csrf_rejected" });
    return;
  }
  requireSameOrigin(req, res, next);
}
