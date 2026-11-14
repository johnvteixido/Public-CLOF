import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: queryMock }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgres://unit-test.invalid/database");
  vi.stubEnv("NODE_ENV", "test");
  queryMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function createDatabase() {
  const { getSupabase } = await import("../../src/server/db");
  const database = getSupabase();
  if (!database) throw new Error("Test database adapter was not initialized.");
  return database;
}

describe("Neon query-builder adapter", () => {
  it("preserves a blank profile rather than injecting owner-specific defaults", async () => {
    const { rowToProfile } = await import("../../src/server/db");
    const profile = rowToProfile({
      id: "singleton",
      full_name: "",
      title: "",
      portfolio_url: "",
      email: "",
      specialties: [],
      custom_rate: "",
      physical_address: "",
      updated_at: new Date(0).toISOString(),
    });

    expect(profile).toEqual({
      fullName: "",
      title: "",
      portfolioUrl: "",
      email: "",
      specialties: [],
      customRate: "",
      physicalAddress: "",
    });
  });

  it("rejects empty updates instead of emitting invalid SQL", async () => {
    const database = await createDatabase();
    const result = await database.from("leads").update({}).eq("id", "lead-1");

    expect(result.error?.message).toBe("Cannot update an empty row");
    expect(queryMock.mock.calls.some(([statement]) =>
      typeof statement === "string" && /^UPDATE\s/i.test(statement),
    )).toBe(false);
  });

  it("uses DO NOTHING when an upsert contains only its conflict key", async () => {
    const database = await createDatabase();
    const result = await database.from("profile").upsert({ id: "singleton" });

    expect(result.error).toBeNull();
    const [statement, values] = queryMock.mock.calls.at(-1) ?? [];
    expect(statement).toBe(
      'INSERT INTO "profile" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING',
    );
    expect(values).toEqual(["singleton"]);
  });

  it("parameterizes values while validating identifiers", async () => {
    const database = await createDatabase();
    const value = "'; DROP TABLE leads; --";
    const result = await database
      .from("leads")
      .update({ notes: value })
      .eq("id", "lead-2");

    expect(result.error).toBeNull();
    const [statement, values] = queryMock.mock.calls.at(-1) ?? [];
    expect(statement).toBe('UPDATE "leads" SET "notes" = $2 WHERE "id" = $1');
    expect(statement).not.toContain("DROP TABLE");
    expect(values).toEqual(["lead-2", value]);
  });

  it("rejects unsafe table names before a query is executed", async () => {
    const database = await createDatabase();
    expect(() => database.from('leads; DROP TABLE leads')).toThrow("Invalid database identifier");
  });
});
