// Best-effort SMTP RCPT TO verification. Honest about uncertainty:
// - 'rcpt'      — server accepted RCPT TO (high confidence)
// - 'mx-only'   — MX exists but RCPT couldn't be checked (medium)
// - 'scraped'   — email was found on the company's contact page (low-medium)
// - 'pattern'   — guessed from a common pattern (low)
// - 'unverified'— no signal
//
// Cloud egress IPs are commonly blocked from port 25 by hyperscalers
// (AWS, GCP, Azure, Vercel). When that happens we surface 'mx-only'
// rather than pretending the address is verified.

import { promises as dns } from "node:dns";
import net from "node:net";

const SMTP_PORT = 25;
const SMTP_TIMEOUT_MS = 5_000;

export type VerificationMethod =
  | "rcpt"
  | "mx-only"
  | "scraped"
  | "pattern"
  | "unverified";

export interface VerificationResult {
  method: VerificationMethod;
  verified: boolean;
  detail?: string;
}

async function resolveMx(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length === 0) return null;
    records.sort((a, b) => a.priority - b.priority);
    return records[0]?.exchange ?? null;
  } catch {
    return null;
  }
}

function probe(mx: string, email: string): Promise<{ ok: boolean; banner: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(SMTP_TIMEOUT_MS);
    let buf = "";
    let stage: "banner" | "helo" | "from" | "rcpt" | "done" = "banner";
    let result: { ok: boolean; banner: string } = { ok: false, banner: "" };

    const cleanup = () => {
      try {
        socket.write("QUIT\r\n");
      } catch {
        /* ignore */
      }
      socket.destroy();
    };

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        const code = line.slice(0, 3);
        if (stage === "banner") {
          result.banner = line;
          if (code === "220") {
            socket.write(`HELO client-lead-finder.local\r\n`);
            stage = "helo";
          } else {
            stage = "done";
            cleanup();
            resolve(result);
            return;
          }
        } else if (stage === "helo") {
          if (code === "250") {
            socket.write(`MAIL FROM:<verify@client-lead-finder.local>\r\n`);
            stage = "from";
          } else {
            cleanup();
            resolve(result);
            return;
          }
        } else if (stage === "from") {
          if (code === "250") {
            socket.write(`RCPT TO:<${email}>\r\n`);
            stage = "rcpt";
          } else {
            cleanup();
            resolve(result);
            return;
          }
        } else if (stage === "rcpt") {
          result.ok = code === "250" || code === "251";
          stage = "done";
          cleanup();
          resolve(result);
          return;
        }
      }
    });

    socket.on("error", () => {
      stage = "done";
      cleanup();
      resolve(result);
    });
    socket.on("timeout", () => {
      stage = "done";
      cleanup();
      resolve(result);
    });
    socket.on("close", () => {
      if (stage !== "done") {
        resolve(result);
      }
    });

    try {
      socket.connect(SMTP_PORT, mx);
    } catch {
      resolve(result);
    }
  });
}

export async function verifyEmail(email: string): Promise<VerificationResult> {
  if (!email || !email.includes("@")) {
    return { method: "unverified", verified: false };
  }
  const domain = email.split("@")[1];
  if (!domain) return { method: "unverified", verified: false };

  const mx = await resolveMx(domain);
  if (!mx) {
    return { method: "unverified", verified: false, detail: "No MX records for domain" };
  }

  if (process.env.DISABLE_SMTP_PROBE === "1") {
    return { method: "mx-only", verified: false, detail: "SMTP probe disabled" };
  }

  try {
    const { ok, banner } = await probe(mx, email);
    if (ok) return { method: "rcpt", verified: true, detail: banner.slice(0, 80) };
    return { method: "mx-only", verified: false, detail: banner.slice(0, 80) };
  } catch {
    return { method: "mx-only", verified: false, detail: "SMTP probe failed" };
  }
}
