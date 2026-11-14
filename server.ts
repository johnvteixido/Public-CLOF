import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import dotenv from "dotenv";
import {
  getSupabase,
  isDbConfigured,
  checkDatabase,
  rowToLead,
  leadToRow,
  rowToProfile,
  profileToRow,
} from "./src/server/db";
import { runLeadPipeline } from "./src/server/leadPipeline";
import {
  isGeminiConfigured,
  isGatewayConfigured,
  personalizeOutreach,
  generatePitchStrategy,
} from "./src/server/gemini";
import { fetchHomepageText } from "./src/server/scrape";
import {
  isGmailConfigured,
  getAuthUrl,
  exchangeCodeAndPersist,
  disconnectGmail,
  getGmailStatus,
  sendOutreachEmail,
  SenderPostalAddressRequiredError,
  OutboundMessageValidationError,
  GmailNotConfiguredError,
  GmailNotConnectedError,
  DailySendCapError,
  SuppressedError,
} from "./src/server/gmail";
import {
  clearSessionCookie,
  createSession,
  isAuthConfigured,
  requireAuth,
  requireCsrf,
  requireSameOrigin,
  sessionFromRequest,
  setSessionCookie,
  verifyAccessPassword,
} from "./src/server/auth";
import { logger, requestLog } from "./src/server/log";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

const app = express();
const PORT = 3000;

// Vercel forwards requests through a single trusted proxy hop. Local
// development does not trust arbitrary forwarded client IP headers.
app.set("trust proxy", process.env.VERCEL === "1" ? 1 : false);

const allowedOrigin = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).origin : false;
  } catch {
    return false;
  }
})();

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  }),
);

// Baseline response protections for the owner workspace and its API.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
});
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use(requestLog);

// ---------------------------------------------------------------------------
// Rate limiting (per-IP token bucket, in-memory)
// ---------------------------------------------------------------------------

type Bucket = { tokens: number; updatedAt: number };
const RATE_BUCKETS = new Map<string, Bucket>();
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_MIN = 30;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(ip) ?? { tokens: RATE_CAPACITY, updatedAt: now };
  const elapsedMin = (now - bucket.updatedAt) / 60_000;
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + elapsedMin * RATE_REFILL_PER_MIN);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    RATE_BUCKETS.set(ip, bucket);
    res.status(429).json({ error: "Too many requests. Try again in a minute." });
    return;
  }
  bucket.tokens -= 1;
  RATE_BUCKETS.set(ip, bucket);
  if (RATE_BUCKETS.size > 10_000) {
    for (const [key, value] of RATE_BUCKETS) {
      if (now - value.updatedAt > 10 * 60_000) RATE_BUCKETS.delete(key);
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbNotConfiguredResponse(res: Response): void {
  res.status(503).json({
    error: "Database not configured.",
    hint: "Connect the Neon integration to this Vercel project, or set DATABASE_URL / POSTGRES_URL server-side."
  });
}

function gatewayTokenFromRequest(req: Request): string | undefined {
  const value = req.headers["x-vercel-oidc-token"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function geminiNotConfiguredResponse(res: Response): void {
  res.status(503).json({
    error: "Gemini API not configured.",
    hint: "Set GEMINI_API_KEY (free tier: https://aistudio.google.com/apikey).",
  });
}

function asArray(input: unknown, maxItems = 20, maxItemLength = 120): string[] {
  const values = Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : typeof input === "string"
      ? input.split(",")
      : [];
  return values
    .map((value) => value.trim().slice(0, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function boundedText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 && value.length <= maxLength ? value : null;
}

function optionalText(input: unknown, maxLength: number, fallback = ""): string {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : fallback;
}

function asTone(input: unknown): "professional" | "warm" | "direct" | "creative" {
  if (input === "warm" || input === "direct" || input === "creative") return input;
  return "professional";
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get(["/api/health", "/health"], async (_req, res) => {
  const database = await checkDatabase();
  res.setHeader("Cache-Control", "no-store");
  res.status(database.connected || !database.configured ? 200 : 503).json({
    ok: database.connected,
    db: database.connected ? "connected" : database.configured ? "error" : "missing",
    geminiSearch: isGeminiConfigured() ? "configured" : "missing",
    aiGateway: isGatewayConfigured(gatewayTokenFromRequest(_req)) ? "configured" : "missing",
    gmail: isGmailConfigured() ? "configured" : "missing",
    authentication: isAuthConfigured() ? "configured" : "misconfigured",
  });
});

// ---------------------------------------------------------------------------
// Owner-only application authentication
// ---------------------------------------------------------------------------

type LoginBucket = { attempts: number; resetAt: number };
const LOGIN_BUCKETS = new Map<string, LoginBucket>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;

function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = LOGIN_BUCKETS.get(ip);
  const bucket = !current || current.resetAt <= now
    ? { attempts: 0, resetAt: now + LOGIN_WINDOW_MS }
    : current;

  if (bucket.attempts >= LOGIN_MAX_ATTEMPTS) {
    res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many sign-in attempts. Try again later.", code: "login_rate_limited" });
    return;
  }

  bucket.attempts += 1;
  LOGIN_BUCKETS.set(ip, bucket);
  if (LOGIN_BUCKETS.size > 10_000) {
    for (const [key, value] of LOGIN_BUCKETS) {
      if (value.resetAt <= now) LOGIN_BUCKETS.delete(key);
    }
  }
  next();
}

app.get("/api/auth/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = sessionFromRequest(req);
  res.json({
    configured: isAuthConfigured(),
    authenticated: Boolean(session),
    csrfToken: session?.csrfToken ?? null,
  });
});

app.post("/api/auth/login", requireSameOrigin, loginRateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthConfigured()) {
    res.status(503).json({
      error: "Set APP_ACCESS_PASSWORD, APP_SESSION_SECRET, and APP_URL before using the application.",
      code: "auth_not_configured",
    });
    return;
  }
  if (!verifyAccessPassword(req.body?.password)) {
    res.status(401).json({ error: "Invalid password.", code: "invalid_credentials" });
    return;
  }

  LOGIN_BUCKETS.delete(req.ip || req.socket.remoteAddress || "unknown");
  const session = createSession();
  setSessionCookie(res, req, session.token);
  res.json({ configured: true, authenticated: true, csrfToken: session.csrfToken });
});

app.post("/api/auth/logout", requireAuth, requireCsrf, rateLimit, (_req, res) => {
  clearSessionCookie(res, _req);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Gmail OAuth + send
// ---------------------------------------------------------------------------

const OAUTH_STATE_COOKIE = "oauth_state";

app.get(["/api/auth/google", "/auth/google"], requireAuth, (req, res) => {
  try {
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || req.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60_000,
    });
    res.redirect(getAuthUrl(state));
  } catch (err) {
    if (err instanceof GmailNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
});

app.get(["/api/auth/callback", "/auth/callback"], requireAuth, async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax",
    path: "/",
  });

  if (oauthError) {
    res.redirect(`/?gmail=error&reason=${encodeURIComponent(String(oauthError))}`);
    return;
  }
  if (!code || typeof code !== "string") {
    res.redirect("/?gmail=error&reason=missing_code");
    return;
  }
  if (!state || state !== cookieState) {
    res.redirect("/?gmail=error&reason=state_mismatch");
    return;
  }

  try {
    await exchangeCodeAndPersist(code);
    res.redirect("/?gmail=connected");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback failed";
    logger.error({ err }, "[auth/callback]");
    res.redirect(`/?gmail=error&reason=${encodeURIComponent(msg.slice(0, 80))}`);
  }
});

app.get(["/api/gmail/status", "/gmail/status"], requireAuth, async (_req, res) => {
  try {
    const status = await getGmailStatus();
    res.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "status failed";
    res.status(500).json({ error: msg });
  }
});

app.post(["/api/gmail/disconnect", "/gmail/disconnect"], requireAuth, requireCsrf, rateLimit, async (_req, res) => {
  try {
    await disconnectGmail();
    res.status(204).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "disconnect failed";
    res.status(500).json({ error: msg });
  }
});

app.post(["/api/send-email", "/send-email"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  if (!isGmailConfigured()) {
    res.status(503).json({
      error: "Gmail OAuth not configured.",
      hint: "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY in your environment.",
    });
    return;
  }
  const sb = getSupabase();
  if (!sb) {
    res.status(503).json({ error: "Neon database not configured. Connect the Neon integration and provide DATABASE_URL." });
    return;
  }

  try {
    const { leadId } = req.body ?? {};
    if (!leadId || typeof leadId !== "string") {
      res.status(400).json({ error: "leadId is required" });
      return;
    }

    const [{ data: leadRow, error: leadErr }, { data: profRow, error: profErr }] = await Promise.all(
      [
        sb.from("leads").select("*").eq("id", leadId).single(),
        sb.from("profile").select("*").eq("id", "singleton").single(),
      ],
    );
    if (leadErr || !leadRow) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (profErr || !profRow) {
      res.status(500).json({ error: "Profile not found" });
      return;
    }

    const lead = rowToLead(leadRow);
    if (!lead.contactEmail) {
      res.status(400).json({ error: "Lead has no contactEmail." });
      return;
    }

    const template = lead.outreachTemplate ?? "";
    const subjectLine = template.match(/^Subject:\s*(.+?)\r?\n/);
    const subject = subjectLine?.[1]?.trim() || `Hello from ${profRow.full_name}`;
    const body = subjectLine
      ? template.slice(subjectLine[0].length).trimStart()
      : template;

    const result = await sendOutreachEmail({
      leadId: lead.id,
      to: lead.contactEmail,
      subject,
      body,
      profile: {
        fullName: profRow.full_name ?? "",
        email: profRow.email ?? "",
        portfolioUrl: profRow.portfolio_url ?? "",
        physicalAddress: profRow.physical_address ?? "",
      },
    });

    // Best-effort: mark the lead as Contacted
    await sb
      .from("leads")
      .update({ status: lead.status === "Lead" ? "Contacted" : lead.status })
      .eq("id", lead.id);

    res.json(result);
  } catch (err) {
    if (err instanceof SenderPostalAddressRequiredError) {
      res.status(400).json({ error: err.message, code: "sender_postal_address_required" });
      return;
    }
    if (err instanceof OutboundMessageValidationError) {
      res.status(400).json({ error: err.message, code: "invalid_message_header" });
      return;
    }
    if (err instanceof GmailNotConnectedError) {
      res.status(409).json({ error: err.message, code: "gmail_not_connected" });
      return;
    }
    if (err instanceof DailySendCapError) {
      res.status(429).json({
        error: err.message,
        code: "daily_cap",
        sentToday: err.sentToday,
        dailyCap: err.cap,
      });
      return;
    }
    if (err instanceof SuppressedError) {
      res.status(409).json({ error: err.message, code: "suppressed" });
      return;
    }
    const msg = err instanceof Error ? err.message : "send failed";
    logger.error({ err }, "[send-email]");
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Leads CRUD
// ---------------------------------------------------------------------------

app.get(["/api/leads", "/leads"], requireAuth, async (_req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ leads: (data ?? []).map(rowToLead) });
});

app.post(["/api/leads", "/leads"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const lead = req.body;
  if (!lead || typeof lead.name !== "string" || lead.name.trim().length === 0) {
    res.status(400).json({ error: "lead.name is required" });
    return;
  }
  const row = leadToRow(lead);
  delete (row as Record<string, unknown>).id;
  const { data, error } = await sb.from("leads").insert(row).select().single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Insert failed" });
    return;
  }
  res.status(201).json({ lead: rowToLead(data) });
});

app.patch(["/api/leads/:id", "/leads/:id"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const id = req.params.id;
  const row = leadToRow(req.body ?? {});
  delete (row as Record<string, unknown>).id;
  const { data, error } = await sb.from("leads").update(row).eq("id", id).select().single();
  if (error || !data) {
    res.status(404).json({ error: error?.message ?? "Lead not found" });
    return;
  }
  res.json({ lead: rowToLead(data) });
});

app.delete(["/api/leads/:id", "/leads/:id"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const id = req.params.id;
  const { error } = await sb.from("leads").delete().eq("id", id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).end();
});

app.get(["/api/profile", "/profile"], requireAuth, async (_req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const { data, error } = await sb.from("profile").select("*").eq("id", "singleton").single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Profile not found" });
    return;
  }
  res.json({ profile: rowToProfile(data) });
});

app.put(["/api/profile", "/profile"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return dbNotConfiguredResponse(res);
  const row = profileToRow(req.body ?? {});
  const { data, error } = await sb
    .from("profile")
    .update(row)
    .eq("id", "singleton")
    .select()
    .single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Profile update failed" });
    return;
  }
  res.json({ profile: rowToProfile(data) });
});

// ---------------------------------------------------------------------------
// Phase 2: Real Gemini-powered lead discovery + personalization
// ---------------------------------------------------------------------------

app.post(["/api/generate-leads", "/generate-leads"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  try {
    const { industry, location, tone, profile, companyScale, techFocus, maxResults } = req.body ?? {};
    const industryText = boundedText(industry, 160);
    const locationText = boundedText(location, 160);
    if (!industryText || !locationText) {
      res.status(400).json({
        error: "industry and location must be non-empty strings of 160 characters or fewer.",
      });
      return;
    }
    const ownerProfile = profile && typeof profile === "object" ? profile : undefined;

    const result = await runLeadPipeline({
      industry: industryText,
      location: locationText,
      tone: asTone(tone),
      companyScale: typeof companyScale === "string" ? companyScale.trim().slice(0, 100) : undefined,
      techFocus: asArray(techFocus, 12, 80),
      profile: {
        // Profile values come only from the owner. Keep first-run profiles blank.
        fullName: optionalText(ownerProfile?.fullName, 120),
        title: optionalText(ownerProfile?.title, 160),
        portfolioUrl: optionalText(ownerProfile?.portfolioUrl, 2048),
        email: optionalText(ownerProfile?.email, 254),
        specialties: asArray(ownerProfile?.specialties, 20, 100),
        customRate: optionalText(ownerProfile?.customRate, 500),
      },
      count: typeof maxResults === "number" && Number.isFinite(maxResults)
        ? Math.min(12, Math.max(1, Math.trunc(maxResults)))
        : undefined,
      gatewayToken: gatewayTokenFromRequest(req),
    });

    const leadsWithIds = result.leads.map((lead, i) => ({
      ...lead,
      id: `pending-${Date.now()}-${i}`,
    }));

    res.json({
      leads: leadsWithIds,
      groundingSources: result.sources,
      rawAnalysis: result.rawAnalysis,
      warnings: result.warnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lead pipeline failed.";
    logger.error({ err }, "[generate-leads]");
    res.status(500).json({ error: msg });
  }
});

app.post(["/api/generate-outreach-template", "/generate-outreach-template"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  try {
    const { companyName, companyWebsite, companyDescription, tone, profile, techFocus } = req.body ?? {};
    const companyNameText = boundedText(companyName, 160);
    if (!companyNameText || !profile || typeof profile !== "object" || Array.isArray(profile)) {
      res.status(400).json({
        error: "companyName must be a non-empty string of 160 characters or fewer and profile must be an object.",
      });
      return;
    }
    const websiteText = optionalText(companyWebsite, 2048);
    let homepageText = "";
    if (websiteText) {
      try {
        const scrape = await fetchHomepageText(websiteText);
        homepageText = scrape.text;
      } catch {
        /* fall through to LLM with empty homepage */
      }
    }
    const out = await personalizeOutreach({
      gatewayToken: gatewayTokenFromRequest(req),
      companyName: companyNameText,
      companyWebsite: websiteText,
      companyDescription: optionalText(companyDescription, 2400),
      homepageText,
      profile: {
        fullName: optionalText(profile.fullName, 120),
        title: optionalText(profile.title, 160),
        portfolioUrl: optionalText(profile.portfolioUrl, 2048),
        email: optionalText(profile.email, 254),
        specialties: asArray(profile.specialties, 20, 100),
        customRate: optionalText(profile.customRate, 500),
      },
      tone: asTone(tone),
      techFocus: asArray(techFocus, 12, 80),
    });
    res.json({
      template: `Subject: ${out.subject}\n\n${out.body}`,
      subject: out.subject,
      body: out.body,
      potentialNeeds: out.potentialNeeds,
      suggestedStack: out.suggestedStack,
      contactPerson: out.contactPerson,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Template generation failed.";
    logger.error({ err }, "[generate-outreach-template]");
    res.status(500).json({ error: msg });
  }
});

app.post(["/api/generate-pitch-strategy", "/generate-pitch-strategy"], requireAuth, requireCsrf, rateLimit, async (req, res) => {
  try {
    const { companyName, companyWebsite, suggestedStack, customExperience } = req.body ?? {};
    const companyNameText = boundedText(companyName, 160);
    if (!companyNameText) {
      res.status(400).json({ error: "companyName must be a non-empty string of 160 characters or fewer." });
      return;
    }
    const websiteText = optionalText(companyWebsite, 2048);
    let homepageText = "";
    if (websiteText) {
      try {
        const scrape = await fetchHomepageText(websiteText);
        homepageText = scrape.text;
      } catch {
        /* empty */
      }
    }
    const strategy = await generatePitchStrategy({
      gatewayToken: gatewayTokenFromRequest(req),
      companyName: companyNameText,
      suggestedStack: asArray(suggestedStack, 20, 100),
      customExperience: optionalText(customExperience, 3000),
      homepageText,
    });
    res.json({ strategy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pitch strategy failed.";
    logger.error({ err }, "[generate-pitch-strategy]");
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logger.info(
      {
        port: PORT,
        db: isDbConfigured() ? "configured" : "missing",
        gemini: isGeminiConfigured() ? "configured" : "missing",
        gmail: isGmailConfigured() ? "configured" : "missing",
        auth: isAuthConfigured() ? "configured" : "misconfigured",
      },
      "Server listening",
    );
  });
}

if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "test") {
  start();
}

export { app };
export default app;
