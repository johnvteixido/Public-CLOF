import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { encrypt, decrypt, isCryptoConfigured } from "../../src/server/crypto";

const KEY = crypto.randomBytes(32).toString("hex");

beforeEach(() => {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = KEY;
});

describe("crypto", () => {
  it("round-trips a plaintext", () => {
    const plain = "1//0abcdEFGHrefresh_token_example";
    const ct = encrypt(plain);
    expect(ct).not.toContain(plain);
    expect(decrypt(ct)).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("hello");
    const b = encrypt("hello");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("hello");
    expect(decrypt(b)).toBe("hello");
  });

  it("detects tampering via the auth tag", () => {
    const ct = encrypt("sensitive");
    const tampered = Buffer.from(ct, "base64");
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered.toString("base64"))).toThrow();
  });

  it("throws when the key is missing", () => {
    delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/GMAIL_TOKEN_ENCRYPTION_KEY/);
    expect(isCryptoConfigured()).toBe(false);
  });

  it("rejects malformed hex even when the valid prefix is 32 bytes", () => {
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = `${"ab".repeat(32)}zz`;
    expect(() => encrypt("x")).toThrow(/32 bytes hex/);
    expect(isCryptoConfigured()).toBe(false);
  });

  it("throws when the key is the wrong length", () => {
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "ab".repeat(16); // 16 bytes, half-size
    expect(() => encrypt("x")).toThrow(/32 bytes hex/);
    expect(isCryptoConfigured()).toBe(false);
  });
});
