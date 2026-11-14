import { describe, expect, it } from "vitest";
import { fetchHomepageText, isPublicAddress, parseHomepageHtml } from "../../src/server/scrape";

const fixture = `<!doctype html><html><body>
  <h1>Acme Dental Clinic</h1>
  <p>We serve Portland, OR. Contact us at hello@acmedental.example or info@acmedental.example.</p>
  <p>Spam: name@example.com (placeholder); also foo@wixpress.com</p>
  <a href="tel:+1-503-555-0100">Call us</a>
  <img src="logo@2x.png" alt="logo">
</body></html>`;

describe("parseHomepageHtml", () => {
  it("extracts clean text and contact candidates from HTML", () => {
    const result = parseHomepageHtml(fixture, "acmedental.example");
    expect(result.text).toContain("Acme Dental Clinic");
    expect(result.text).toContain("Portland, OR");
    expect(result.emails).toContain("hello@acmedental.example");
    expect(result.emails).toContain("info@acmedental.example");
    expect(result.emails.some((email) => email.startsWith("name@"))).toBe(false);
    expect(result.emails.some((email) => email.endsWith("@wixpress.com"))).toBe(false);
    expect(result.emails.some((email) => email.includes("logo@"))).toBe(false);
    expect(result.phones).toContain("+1-503-555-0100");
  });
});

describe("scraper URL policy", () => {
  it("accepts globally routable IP addresses and rejects reserved ranges", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.5",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2001:2::1",
      "2002:0808:0808::1",
      "3fff::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("returns an empty result for malformed URLs", async () => {
    const result = await fetchHomepageText("not-a-url");
    expect(result).toEqual({ text: "", fetched: 0, attempted: 0, emails: [], phones: [] });
  });

  it("refuses local, link-local, literal-IP, unsupported-scheme, and nonstandard-port targets", async () => {
    const targets = [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.10/",
      "http://[::1]/",
      "file:///etc/passwd",
      "http://public.example:8080/",
      "http://public.example:443/",
      "https://public.example:80/",
    ];
    for (const target of targets) {
      const result = await fetchHomepageText(target);
      expect(result.fetched, target).toBe(0);
      expect(result.emails, target).toEqual([]);
    }
  });
});
