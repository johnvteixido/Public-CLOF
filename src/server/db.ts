import { neon } from "@neondatabase/serverless";
import type { ClientLead, UserProfile } from "../types";

type DbError = { message: string; code?: string };
type DbResult<T = any> = { data: T; error: DbError | null; count?: number | null };
type Filter = { column: string; op: "=" | ">="; value: unknown };

const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid database identifier");
  return '"' + value + '"';
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaPromise: Promise<void> | null = null;

function getSql() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) return null;
  if (!sqlClient) sqlClient = neon(connectionString);
  return sqlClient;
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  const sql = getSql();
  if (!sql) throw new Error("Neon database is not configured. Connect the Neon integration to this Vercel project.");
  schemaPromise = (async () => {
    const statements = [
      `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
      `CREATE TABLE IF NOT EXISTS profile (
        id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
        full_name text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '',
        portfolio_url text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
        specialties text[] NOT NULL DEFAULT '{}', custom_rate text NOT NULL DEFAULT '',
        physical_address text NOT NULL DEFAULT '',
        gmail_refresh_token_encrypted text, gmail_email text, gmail_connected_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE profile ADD COLUMN IF NOT EXISTS physical_address text NOT NULL DEFAULT ''`,
      `ALTER TABLE profile ADD COLUMN IF NOT EXISTS gmail_refresh_token_encrypted text`,
      `ALTER TABLE profile ADD COLUMN IF NOT EXISTS gmail_email text`,
      `ALTER TABLE profile ADD COLUMN IF NOT EXISTS gmail_connected_at timestamptz`,
      `INSERT INTO profile (id) VALUES ('singleton')
       ON CONFLICT (id) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, website text NOT NULL DEFAULT '',
        industry text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '', latitude double precision,
        longitude double precision, description text NOT NULL DEFAULT '', potential_needs text[] NOT NULL DEFAULT '{}',
        suggested_stack text[] NOT NULL DEFAULT '{}', contact_email text NOT NULL DEFAULT '',
        contact_phone text, sms_template text, cold_call_script text, voicemail_script text,
        email_verified boolean NOT NULL DEFAULT false, verification_method text NOT NULL DEFAULT 'unverified',
        contact_person text NOT NULL DEFAULT '', outreach_template text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'Lead', notes text NOT NULL DEFAULT '',
        date_added date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT 'Manual',
        homepage_snapshot text, gemini_raw jsonb, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_phone text`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_template text`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cold_call_script text`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS voicemail_script text`,
      `CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status)`,
      `CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS sends (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        sent_at timestamptz NOT NULL DEFAULT now(), gmail_message_id text, subject text NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'sent', error text
      )`,
      `CREATE INDEX IF NOT EXISTS sends_lead_id_idx ON sends (lead_id)`,
      `CREATE INDEX IF NOT EXISTS sends_sent_at_idx ON sends (sent_at DESC)`,
      `CREATE TABLE IF NOT EXISTS suppressions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
        domain text GENERATED ALWAYS AS (split_part(email, '@', 2)) STORED,
        reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS suppressions_domain_idx ON suppressions (domain)`,
    ];
    try {
      for (const statement of statements) await sql.query(statement, []);
    } catch (error) {
      schemaPromise = null;
      throw error;
    }
  })();
  return schemaPromise;
}

class QueryBuilder implements PromiseLike<DbResult> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private maxRows: number | null = null;
  private singleRow = false;
  private countExact = false;
  private headOnly = false;
  private conflictColumns = "id";
  private orFilters: Filter[] = [];

  constructor(private readonly table: string) { identifier(table); }

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.columns = columns;
    this.countExact = options?.count === "exact";
    this.headOnly = options?.head === true;
    return this;
  }
  insert(payload: Record<string, unknown> | Record<string, unknown>[]) { this.action = "insert"; this.payload = payload; return this; }
  update(payload: Record<string, unknown>) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(payload: Record<string, unknown>, options?: { onConflict?: string }) {
    this.action = "upsert"; this.payload = payload; this.conflictColumns = options?.onConflict ?? "id"; return this;
  }
  eq(column: string, value: unknown) { this.filters.push({ column, op: "=", value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column, op: ">=", value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending !== false }; return this; }
  limit(value: number) { this.maxRows = Math.max(0, Math.min(1000, value)); return this; }
  single() { this.singleRow = true; return this; }
  or(expression: string) {
    for (const term of expression.split(",")) {
      const match = term.match(/^([a-z_][a-z0-9_]*)\.eq\.(.*)$/i);
      if (match) this.orFilters.push({ column: match[1]!, op: "=", value: match[2] });
    }
    return this;
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): Promise<DbResult> {
    try {
      const sql = getSql();
      if (!sql) return { data: null, error: { message: "Neon database is not configured. Add DATABASE_URL through the Vercel Neon integration." } };
      await ensureSchema();
      const values: unknown[] = [];
      const bind = (value: unknown) => { values.push(value); return "$" + values.length; };
      const where: string[] = this.filters.map(f => identifier(f.column) + " " + f.op + " " + bind(f.value));
      if (this.orFilters.length) where.push("(" + this.orFilters.map(f => identifier(f.column) + " = " + bind(f.value)).join(" OR ") + ")");
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      let query = "";
      let returnsRows = false;

      if (this.countExact && this.action === "select") {
        query = "SELECT count(*)::int AS count FROM " + identifier(this.table) + whereSql;
      } else if (this.action === "select") {
        const cols = this.columns === "*" ? "*" : this.columns.split(",").map(c => identifier(c.trim())).join(", ");
        query = "SELECT " + cols + " FROM " + identifier(this.table) + whereSql;
        if (this.orderBy) query += " ORDER BY " + identifier(this.orderBy.column) + (this.orderBy.ascending ? " ASC" : " DESC");
        if (this.maxRows !== null) query += " LIMIT " + this.maxRows;
        returnsRows = true;
      } else if (this.action === "insert" || this.action === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
        if (!keys.length) throw new Error("Cannot insert an empty row");
        const tuples = rows.map(row => "(" + keys.map(k => bind(row[k] ?? null)).join(", ") + ")");
        query = "INSERT INTO " + identifier(this.table) + " (" + keys.map(identifier).join(", ") + ") VALUES " + tuples.join(", ");
        if (this.action === "upsert") {
          const conflicts = this.conflictColumns.split(",").map(c => c.trim());
          const updateKeys = keys.filter(k => !conflicts.includes(k));
          query += " ON CONFLICT (" + conflicts.map(identifier).join(", ") + ") ";
          if (updateKeys.length === 0) {
            query += "DO NOTHING";
          } else {
            query += "DO UPDATE SET " +
              updateKeys.map(k => identifier(k) + " = EXCLUDED." + identifier(k)).join(", ");
          }
        }
        if (this.columns !== "*") { /* .select() marks returned rows even with default columns */ }
        if (this.action === "insert" && this.singleRow || this.columns !== "*") { query += " RETURNING *"; returnsRows = true; }
      } else if (this.action === "update") {
        const row = (this.payload ?? {}) as Record<string, unknown>;
        const keys = Object.keys(row);
        if (keys.length === 0) throw new Error("Cannot update an empty row");
        query = "UPDATE " + identifier(this.table) + " SET " + keys.map(k => identifier(k) + " = " + bind(row[k] ?? null)).join(", ") + whereSql;
        if (this.singleRow || this.columns !== "*") { query += " RETURNING *"; returnsRows = true; }
      } else if (this.action === "delete") {
        query = "DELETE FROM " + identifier(this.table) + whereSql;
        if (this.singleRow || this.columns !== "*") { query += " RETURNING *"; returnsRows = true; }
      }

      const result = await sql.query(query, values);
      if (this.countExact) return { data: null, count: Number((result as unknown as Record<string, unknown>[])[0]?.count ?? 0), error: null };
      const data = returnsRows ? result : null;
      if (this.singleRow) {
        if (!Array.isArray(data) || !data[0]) return { data: null, error: { message: "No rows found", code: "PGRST116" } };
        return { data: data[0], error: null };
      }
      return { data: data, error: null };
    } catch (error) {
      const e = error as { message?: string; code?: string };
      return { data: null, error: { message: e.message ?? "Database query failed", code: e.code } };
    }
  }
}

export function getSupabase() {
  if (!getSql()) return null;
  return { from: (table: string) => new QueryBuilder(table) };
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED);
}

export async function checkDatabase(): Promise<{ configured: boolean; connected: boolean; error?: string }> {
  const sql = getSql();
  if (!sql) return { configured: false, connected: false, error: "DATABASE_URL is missing" };
  try {
    await ensureSchema();
    await sql.query("SELECT 1 AS ok", []);
    return { configured: true, connected: true };
  } catch (error) {
    return { configured: true, connected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type LeadRow = {
  id: string; name: string; website: string; industry: string; location: string;
  latitude: number | null; longitude: number | null; description: string; potential_needs: string[];
  suggested_stack: string[]; contact_email: string; contact_phone: string | null; sms_template: string | null;
  cold_call_script: string | null; voicemail_script: string | null; email_verified: boolean;
  verification_method: string; contact_person: string; outreach_template: string; status: string; notes: string;
  date_added: string; source: string; homepage_snapshot: string | null; gemini_raw: unknown;
  created_at: string; updated_at: string;
};

export function rowToLead(row: LeadRow): ClientLead {
  return {
    id: row.id, name: row.name, website: row.website, industry: row.industry, location: row.location,
    latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined, description: row.description,
    potentialNeeds: row.potential_needs, suggestedStack: row.suggested_stack, contactEmail: row.contact_email,
    contactPhone: row.contact_phone ?? undefined, smsTemplate: row.sms_template ?? undefined,
    coldCallScript: row.cold_call_script ?? undefined, voicemailScript: row.voicemail_script ?? undefined,
    emailVerified: row.email_verified, verificationMethod: row.verification_method as ClientLead["verificationMethod"],
    contactPerson: row.contact_person, outreachTemplate: row.outreach_template, status: row.status as ClientLead["status"],
    notes: row.notes, dateAdded: row.date_added, source: row.source as ClientLead["source"],
  };
}

export function leadToRow(lead: Partial<ClientLead>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const map: [keyof ClientLead, string][] = [
    ["id", "id"], ["name", "name"], ["website", "website"], ["industry", "industry"], ["location", "location"],
    ["latitude", "latitude"], ["longitude", "longitude"], ["description", "description"], ["potentialNeeds", "potential_needs"],
    ["suggestedStack", "suggested_stack"], ["contactEmail", "contact_email"], ["contactPhone", "contact_phone"],
    ["smsTemplate", "sms_template"], ["coldCallScript", "cold_call_script"], ["voicemailScript", "voicemail_script"],
    ["emailVerified", "email_verified"], ["verificationMethod", "verification_method"], ["contactPerson", "contact_person"],
    ["outreachTemplate", "outreach_template"], ["status", "status"], ["notes", "notes"], ["dateAdded", "date_added"], ["source", "source"],
  ];
  for (const [source, target] of map) if (lead[source] !== undefined) row[target] = lead[source] ?? null;
  return row;
}

type ProfileRow = { id: string; full_name: string; title: string; portfolio_url: string; email: string; specialties: string[]; custom_rate: string; physical_address: string; updated_at: string };

export function rowToProfile(row: ProfileRow): UserProfile {
  const profile = { fullName: row.full_name, title: row.title, portfolioUrl: row.portfolio_url, email: row.email, specialties: row.specialties, customRate: row.custom_rate, physicalAddress: row.physical_address ?? "" };
  return profile;
}

export function profileToRow(profile: Partial<UserProfile>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const map: [keyof UserProfile, string][] = [
    ["fullName", "full_name"], ["title", "title"], ["portfolioUrl", "portfolio_url"], ["email", "email"],
    ["specialties", "specialties"], ["customRate", "custom_rate"], ["physicalAddress", "physical_address"],
  ];
  for (const [source, target] of map) if (profile[source] !== undefined) row[target] = profile[source];
  return row;
}
