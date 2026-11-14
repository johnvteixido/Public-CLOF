import { afterEach, describe, expect, it, vi } from "vitest";
import { personalizeOutreach } from "../../src/server/gemini";

afterEach(() => {
  vi.unstubAllEnvs();
});

function profile(fullName = "") {
  return {
    fullName,
    title: "",
    portfolioUrl: "",
    email: "",
    specialties: [],
    customRate: "",
  };
}

describe("deterministic outreach fallback", () => {
  it("does not insert an owner identity when the first-run profile is blank", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");

    const result = await personalizeOutreach({
      companyName: "Example Services",
      companyWebsite: "https://example.test",
      companyDescription: "",
      homepageText: "",
      profile: profile(),
      tone: "professional",
      techFocus: [],
    });

    const generated = JSON.stringify(result);
    expect(generated).not.toContain("PRIVATE_OWNER_NAME");
    expect(generated).not.toContain("johnvteixido");
    expect(generated).not.toContain("Teixido Labs");
    expect(result.body).not.toMatch(/linkedin\.com/i);
  });

  it("uses a sender identity only when it is explicitly supplied", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");

    const result = await personalizeOutreach({
      companyName: "Example Services",
      companyWebsite: "https://example.test",
      companyDescription: "",
      homepageText: "",
      profile: profile("Ada Example"),
      tone: "professional",
      techFocus: [],
    });

    expect(result.body).toContain("Ada Example");
    expect(JSON.stringify(result)).not.toContain("Teixido Labs");
  });
});
