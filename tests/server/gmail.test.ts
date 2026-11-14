import { describe, it, expect } from "vitest";
import { appendFooter, encodeRfc822, parseDailySendCap, sendOutreachEmail, SenderPostalAddressRequiredError, OutboundMessageValidationError } from "../../src/server/gmail";

describe("appendFooter", () => {
  const profile = {
    fullName: "Example Sender",
    email: "sender@example.test",
    portfolioUrl: "https://example.com/portfolio",
    physicalAddress: "123 Example Street, Testville, CA 90000",
  };

  it("appends sender name, portfolio, email, address, and STOP line", () => {
    const out = appendFooter("Hi,\n\nLet's chat next week.", profile);
    expect(out).toContain("Example Sender");
    expect(out).toContain("https://example.com/portfolio");
    expect(out).toContain("sender@example.test");
    expect(out).toContain("123 Example Street, Testville, CA 90000");
    expect(out).toMatch(/reply.+STOP/i);
  });

  it("preserves the original body verbatim above the footer", () => {
    const body = "Subject: Hello\n\nFirst para.\n\nSecond para.";
    const out = appendFooter(body, profile);
    expect(out.startsWith(body)).toBe(true);
  });

  it("uses '--' as the footer separator (standard email signature)", () => {
    const out = appendFooter("Hello", profile);
    expect(out).toContain("\n--\n");
  });

  it("trims trailing whitespace from the body before appending", () => {
    const out = appendFooter("Hello\n\n\n", profile);
    expect(out).toMatch(/Hello\n\n--\nExample Sender/);
    expect(out).not.toMatch(/Hello\n\n\n/);
  });

  it("omits empty profile fields", () => {
    const out = appendFooter("Hi", {
      fullName: "J",
      email: "",
      portfolioUrl: "",
      physicalAddress: "",
    });
    expect(out).toContain("J");
    // No empty portfolio/email/address lines between name and STOP line
    expect(out).not.toContain("\n\nTo opt out");
    expect(out).not.toMatch(/J\n\nTo opt out/);
  });
});


describe("daily send cap configuration", () => {
  it("uses the default when the setting is missing or blank", () => {
    expect(parseDailySendCap(undefined)).toBe(80);
    expect(parseDailySendCap("")).toBe(80);
    expect(parseDailySendCap("   ")).toBe(80);
  });

  it("accepts non-negative integer limits including zero", () => {
    expect(parseDailySendCap("0")).toBe(0);
    expect(parseDailySendCap("80")).toBe(80);
    expect(parseDailySendCap("250")).toBe(250);
  });

  it("fails closed to the default for malformed, fractional, negative, or unsafe values", () => {
    for (const invalid of ["NaN", "Infinity", "-1", "1.5", "1e6", "999999999999999999999999", "80x"]) {
      expect(parseDailySendCap(invalid), invalid).toBe(80);
    }
  });
});


describe("RFC 822 message construction", () => {
  const base = {
    to: "prospect@example.test",
    from: "sender@example.test",
    fromName: "Example Sender",
    subject: "A practical idea",
    body: "Hello there.",
  };

  it("constructs a plain-text message with safe sender and recipient headers", () => {
    const raw = Buffer.from(encodeRfc822(base), "base64url").toString("utf8");
    expect(raw).toContain('From: "Example Sender" <sender@example.test>');
    expect(raw).toContain("To: prospect@example.test");
    expect(raw).toContain("Subject: A practical idea");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
  });

  it("rejects CRLF injection in recipient, sender name, and subject headers", () => {
    expect(() => encodeRfc822({ ...base, to: "prospect@example.test\r\nBcc: victim@example.test" }))
      .toThrow(OutboundMessageValidationError);
    expect(() => encodeRfc822({ ...base, fromName: "Example Sender\r\nBcc: victim@example.test" }))
      .toThrow(OutboundMessageValidationError);
    expect(() => encodeRfc822({ ...base, subject: "Hello\r\nBcc: victim@example.test" }))
      .toThrow(OutboundMessageValidationError);
  });

  it("encodes non-ASCII sender names and subjects as MIME encoded words", () => {
    const raw = Buffer.from(encodeRfc822({
      ...base,
      fromName: "Élodie Example",
      subject: "Résumé for Example",
    }), "base64url").toString("utf8");
    expect(raw).toContain("=?UTF-8?B?");
    expect(raw).not.toContain("Élodie Example");
    expect(raw).not.toContain("Résumé for Example");
  });

  it("rejects malformed email addresses", () => {
    expect(() => encodeRfc822({ ...base, to: "not-an-email" }))
      .toThrow(OutboundMessageValidationError);
  });
});

describe("outbound email safeguards", () => {
  it("blocks sending when the sender postal address is missing", async () => {
    await expect(sendOutreachEmail({
      leadId: "lead-1",
      to: "prospect@example.test",
      subject: "A practical idea",
      body: "Hello.",
      profile: {
        fullName: "Example Sender",
        email: "sender@example.test",
        portfolioUrl: "",
        physicalAddress: " ",
      },
    })).rejects.toBeInstanceOf(SenderPostalAddressRequiredError);
  });
});
