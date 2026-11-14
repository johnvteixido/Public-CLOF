import crypto from "node:crypto";

// AES-256-GCM tamper-evident encryption.
// Payload format (base64): iv (12 bytes) | tag (16 bytes) | ciphertext.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function loadKey(): Buffer {
  const hex = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY is unset. Generate one with: openssl rand -hex 32",
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      `GMAIL_TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes hex (${KEY_BYTES * 2} hex chars).`,
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `GMAIL_TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes hex (${KEY_BYTES * 2} hex chars).`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = loadKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function isCryptoConfigured(): boolean {
  const hex = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  return typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex);
}
