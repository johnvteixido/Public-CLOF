import type { ClientLead, UserProfile } from "../types";

const API_BASE = "/api";
let csrfToken: string | null = null;

export interface AppSessionState {
  configured: boolean;
  authenticated: boolean;
  csrfToken: string | null;
}

function headers(extra: Record<string, string> = {}, includeCsrf = false): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (includeCsrf && csrfToken) result["X-CSRF-Token"] = csrfToken;
  return result;
}

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Database not configured on the server");
    this.name = "DbNotConfiguredError";
  }
}

async function parseError(res: Response): Promise<{ error?: string; code?: string }> {
  try {
    return (await res.json()) as { error?: string; code?: string };
  } catch {
    return {};
  }
}

export async function getSession(): Promise<AppSessionState> {
  const res = await fetch(`${API_BASE}/auth/session`, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`Session check failed: ${res.status}`);
  const session = (await res.json()) as AppSessionState;
  csrfToken = session.csrfToken;
  return session;
}

export async function login(password: string): Promise<AppSessionState> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(),
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const detail = await parseError(res);
    throw new Error(detail.error ?? `Sign-in failed: ${res.status}`);
  }
  const session = (await res.json()) as AppSessionState;
  csrfToken = session.csrfToken;
  return session;
}

export async function logout(): Promise<void> {
  await call<void>("POST", "/auth/logout");
  csrfToken = null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: headers({}, mutating),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const detail = await parseError(res);
    if (res.status === 503 && detail.code !== "auth_not_configured") {
      throw new DbNotConfiguredError();
    }
    throw new Error(`${method} ${path} → ${res.status}${detail.error ? `: ${detail.error}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return call<T>("POST", path, body);
}

export async function listLeads(): Promise<ClientLead[]> {
  const { leads } = await call<{ leads: ClientLead[] }>("GET", "/leads");
  return leads;
}

export async function createLead(lead: Omit<ClientLead, "id">): Promise<ClientLead> {
  const { lead: created } = await call<{ lead: ClientLead }>("POST", "/leads", lead);
  return created;
}

export async function updateLead(id: string, patch: Partial<ClientLead>): Promise<ClientLead> {
  const { lead } = await call<{ lead: ClientLead }>("PATCH", `/leads/${encodeURIComponent(id)}`, patch);
  return lead;
}

export async function deleteLead(id: string): Promise<void> {
  await call<void>("DELETE", `/leads/${encodeURIComponent(id)}`);
}

export async function getProfile(): Promise<UserProfile> {
  const { profile } = await call<{ profile: UserProfile }>("GET", "/profile");
  return profile;
}

export async function updateProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const { profile } = await call<{ profile: UserProfile }>("PUT", "/profile", patch);
  return profile;
}

export interface GmailStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
  sentToday: number;
  dailyCap: number;
}

export async function getGmailStatus(): Promise<GmailStatus> {
  return await call<GmailStatus>("GET", "/gmail/status");
}

export async function disconnectGmail(): Promise<void> {
  await call<void>("POST", "/gmail/disconnect");
}

export interface SendEmailResult {
  messageId: string;
  sentAt: string;
  sentToday: number;
  dailyCap: number;
}

export class SendEmailError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message);
    this.name = "SendEmailError";
  }
}

export async function sendEmail(leadId: string): Promise<SendEmailResult> {
  const res = await fetch(`${API_BASE}/send-email`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers({}, true),
    body: JSON.stringify({ leadId }),
  });
  if (res.ok) return (await res.json()) as SendEmailResult;
  const detail = await parseError(res);
  throw new SendEmailError(res.status, detail.code, detail.error ?? `send-email → ${res.status}`);
}

export function getGmailConnectUrl(): string {
  return `${API_BASE}/auth/google`;
}
