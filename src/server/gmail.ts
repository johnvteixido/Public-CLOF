import { google, gmail_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { decrypt, encrypt, isCryptoConfigured } from "./crypto";
import { getSupabase } from "./db";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"] as const;
export function parseDailySendCap(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 80;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return 80;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : 80;
}

export const DAILY_SEND_CAP = parseDailySendCap(process.env.GMAIL_DAILY_CAP);

export class GmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Gmail OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY.",
    );
    this.name = "GmailNotConfiguredError";
  }
}
export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected. Connect via /api/auth/google.");
    this.name = "GmailNotConnectedError";
  }
}
export class DailySendCapError extends Error {
  constructor(public sentToday: number, public cap: number) {
    super(`Daily send cap reached (${sentToday}/${cap}).`);
    this.name = "DailySendCapError";
  }
}
export class SuppressedError extends Error {
  constructor(public reason: string) {
    super("Recipient is on the suppression list: " + reason);
    this.name = "SuppressedError";
  }
}

export class SenderPostalAddressRequiredError extends Error {
  constructor() {
    super("Add the sender's postal address in Profile Settings before sending commercial outreach email.");
    this.name = "SenderPostalAddressRequiredError";
  }
}

export class OutboundMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundMessageValidationError";
  }
}

export function isGmailConfigured(): boolean {
  return (
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    isCryptoConfigured()
  );
}

function getRedirectUri(): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/callback`;
}

export function getOauthClient(): OAuth2Client {
  if (!isGmailConfigured()) throw new GmailNotConfiguredError();
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    getRedirectUri(),
  );
}

export function getAuthUrl(state: string): string {
  return getOauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GMAIL_SCOPES],
    state,
  });
}

export interface ExchangeResult {
  email: string;
}

export async function exchangeCodeAndPersist(code: string): Promise<ExchangeResult> {
  const oauth = getOauthClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke access at https://myaccount.google.com/permissions and reconnect.",
    );
  }
  oauth.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth });
  const me = await oauth2.userinfo.get();
  const email = me.data.email ?? "";

  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured; cannot persist Gmail token.");

  const encrypted = encrypt(tokens.refresh_token);
  const { error } = await sb
    .from("profile")
    .update({
      gmail_refresh_token_encrypted: encrypted,
      gmail_email: email,
      gmail_connected_at: new Date().toISOString(),
    })
    .eq("id", "singleton");
  if (error) throw new Error(`Failed to persist Gmail token: ${error.message}`);

  // Never return the plaintext refresh token from the persistence boundary.
  return { email };
}

export async function disconnectGmail(): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured.");
  const { error } = await sb
    .from("profile")
    .update({
      gmail_refresh_token_encrypted: null,
      gmail_email: null,
      gmail_connected_at: null,
    })
    .eq("id", "singleton");
  if (error) throw new Error(`Failed to disconnect Gmail: ${error.message}`);
}

export interface GmailStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
  sentToday: number;
  dailyCap: number;
}

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getGmailStatus(): Promise<GmailStatus> {
  const sb = getSupabase();
  if (!sb) {
    return { connected: false, sentToday: 0, dailyCap: DAILY_SEND_CAP };
  }
  const [{ data: prof }, { count }] = await Promise.all([
    sb
      .from("profile")
      .select("gmail_email,gmail_refresh_token_encrypted,gmail_connected_at")
      .eq("id", "singleton")
      .single(),
    sb
      .from("sends")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", startOfDayIso())
      .eq("status", "sent"),
  ]);
  return {
    connected: !!prof?.gmail_refresh_token_encrypted,
    email: prof?.gmail_email ?? undefined,
    connectedAt: prof?.gmail_connected_at ?? undefined,
    sentToday: count ?? 0,
    dailyCap: DAILY_SEND_CAP,
  };
}

async function loadGmailClient(): Promise<gmail_v1.Gmail> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured.");
  const { data, error } = await sb
    .from("profile")
    .select("gmail_refresh_token_encrypted")
    .eq("id", "singleton")
    .single();
  if (error || !data?.gmail_refresh_token_encrypted) {
    throw new GmailNotConnectedError();
  }
  const refresh = decrypt(data.gmail_refresh_token_encrypted);
  const oauth = getOauthClient();
  oauth.setCredentials({ refresh_token: refresh });
  return google.gmail({ version: "v1", auth: oauth });
}

export interface ProfileSummary {
  fullName: string;
  email: string;
  portfolioUrl: string;
  physicalAddress: string;
}

export function appendFooter(body: string, profile: ProfileSummary): string {
  const trimmed = body.trimEnd();
  const lines: string[] = ["", "--", profile.fullName];
  if (profile.portfolioUrl) lines.push(profile.portfolioUrl);
  if (profile.email) lines.push(profile.email);
  if (profile.physicalAddress) lines.push(profile.physicalAddress);
  lines.push("To opt out of future commercial emails, reply with the word STOP.");
  return `${trimmed}\n${lines.join("\n")}`;
}

function cleanHeaderValue(value: string, label: string, maxLength = 200): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new OutboundMessageValidationError(label + " is empty, too long, or contains unsupported control characters.");
  }
  return normalized;
}

function encodeMimeHeaderText(value: string, label: string): string {
  const normalized = cleanHeaderValue(value, label);
  if (/[^\x20-\x7e]/.test(normalized)) {
    const base64 = Buffer.from(normalized, "utf8").toString("base64");
    const chunks = base64.match(/.{1,60}/g) ?? [];
    return chunks.map((chunk) => "=?UTF-8?B?" + chunk + "?=").join("\r\n ");
  }
  return normalized;
}

function validateEmailAddress(value: string, label: string): string {
  const normalized = cleanHeaderValue(value, label, 254);
  const emailPattern = /^[A-Z0-9.!#$%&'*+\/=?^_{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
  if (!emailPattern.test(normalized)) {
    throw new OutboundMessageValidationError(label + " is not a valid email address.");
  }
  return normalized;
}

export function encodeRfc822(params: {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
}): string {
  const to = validateEmailAddress(params.to, "Recipient");
  const from = validateEmailAddress(params.from, "Sender");
  const subject = encodeMimeHeaderText(params.subject, "Subject");
  const displayName = params.fromName ? encodeMimeHeaderText(params.fromName, "Sender name") : "";
  const encodedDisplayName = displayName
    ? (/[^\x20-\x7e]/.test(displayName)
      ? displayName
      : '"' + displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
    : "";
  const fromHeader = encodedDisplayName ? encodedDisplayName + " <" + from + ">" : from;
  const headers = [
    "From: " + fromHeader,
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
  ];
  const msg = headers.join("\r\n") + "\r\n" + params.body;
  return Buffer.from(msg, "utf8").toString("base64url");
}

export interface SendParams {
  leadId: string;
  to: string;
  subject: string;
  body: string;
  profile: ProfileSummary;
}

export interface SendResult {
  messageId: string;
  sentAt: string;
  sentToday: number;
  dailyCap: number;
}

export async function sendOutreachEmail(params: SendParams): Promise<SendResult> {
  validateEmailAddress(params.to, "Recipient");
  if (!params.profile.physicalAddress.trim()) {
    throw new SenderPostalAddressRequiredError();
  }
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured.");

  // Suppression check (exact email OR domain)
  const domain = params.to.split("@")[1] ?? "";
  const { data: sup } = await sb
    .from("suppressions")
    .select("email,domain,reason")
    .or(`email.eq.${params.to.toLowerCase()},domain.eq.${domain.toLowerCase()}`)
    .limit(1);
  if (sup && sup.length > 0) {
    const first = sup[0];
    throw new SuppressedError(first?.reason ?? "suppressed");
  }

  // Daily cap
  const { count: sentToday } = await sb
    .from("sends")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", startOfDayIso())
    .eq("status", "sent");
  const todayCount = sentToday ?? 0;
  if (todayCount >= DAILY_SEND_CAP) {
    throw new DailySendCapError(todayCount, DAILY_SEND_CAP);
  }

  // Build the message
  const gmail = await loadGmailClient();
  const status = await getGmailStatus();
  if (!status.connected || !status.email) throw new GmailNotConnectedError();

  const bodyWithFooter = appendFooter(params.body, params.profile);
  const raw = encodeRfc822({
    to: params.to,
    from: status.email,
    fromName: params.profile.fullName,
    subject: params.subject,
    body: bodyWithFooter,
  });

  let messageId = "";
  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    messageId = res.data.id ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from("sends").insert({
      lead_id: params.leadId,
      gmail_message_id: null,
      subject: params.subject,
      body: bodyWithFooter,
      status: "failed",
      error: message.slice(0, 500),
    });
    if (message.includes("429") || message.toLowerCase().includes("abuse")) {
      await sb
        .from("suppressions")
        .upsert({ email: domain ? `*@${domain}` : params.to.toLowerCase(), reason: `Auto-suppressed after Gmail send error: ${message.slice(0, 100)}` }, { onConflict: "email" });
    }
    throw err;
  }

  const sentAt = new Date().toISOString();
  await sb.from("sends").insert({
    lead_id: params.leadId,
    gmail_message_id: messageId,
    subject: params.subject,
    body: bodyWithFooter,
    status: "sent",
  });

  return {
    messageId,
    sentAt,
    sentToday: todayCount + 1,
    dailyCap: DAILY_SEND_CAP,
  };
}
