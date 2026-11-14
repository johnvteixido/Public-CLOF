import * as cheerio from "cheerio";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

const HOMEPAGE_TIMEOUT_MS = 5_000;
const MAX_BYTES = 200_000;
const MAX_REDIRECTS = 3;
const PATHS = ["", "/about", "/about-us", "/contact", "/services"];

const UA =
  "Mozilla/5.0 (compatible; ClientLeadFinder/1.0; +https://github.com/johnvteixido/Client-Lead-and-Outreach-Finder)";

type ResolvedAddress = { address: string; family: number };

function isPublicIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  if (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  ) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family !== 6) return false;

  // Only global-unicast IPv6 (2000::/3) is accepted. This excludes
  // loopback, link-local, unique-local, multicast, mapped, and unspecified ranges.
  const firstHextet = Number.parseInt(address.split(":")[0] ?? "", 16);
  if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
  const normalized = address.toLowerCase();
  const hextets = normalized.split(":");
  const secondHextet = Number.parseInt(hextets[1] ?? "0", 16);
  if (
    firstHextet === 0x3fff || // documentation prefix
    (firstHextet === 0x2001 && (secondHextet <= 0x01ff || secondHextet === 0x0db8)) ||
    firstHextet === 0x2002 // 6to4
  ) return false;
  return true;
}

function isAllowedUrl(input: URL): boolean {
  const protocolAllowed = input.protocol === "http:" || input.protocol === "https:";
  const hostname = input.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const portAllowed = input.protocol === "http:"
    ? !input.port || input.port === "80"
    : input.protocol === "https:"
      ? !input.port || input.port === "443"
      : false;
  const localSuffix = [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".onion"];
  return (
    protocolAllowed &&
    portAllowed &&
    !input.username &&
    !input.password &&
    hostname.length > 0 &&
    isIP(hostname) === 0 &&
    hostname !== "localhost" &&
    !localSuffix.some((suffix) => hostname.endsWith(suffix))
  );
}

function resolveBeforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(null);
      },
    );
  });
}

async function resolvePublicAddresses(hostname: string, signal: AbortSignal): Promise<ResolvedAddress[] | null> {
  const resolved = await resolveBeforeAbort(
    dnsLookup(hostname, { all: true, verbatim: true }),
    signal,
  );
  if (!resolved || signal.aborted || resolved.length === 0) return null;
  if (resolved.some((entry) => !isPublicAddress(entry.address))) return null;
  return resolved;
}

async function readLimitedBody(response: UndiciResponse): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return "";
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  let received = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > MAX_BYTES) {
        await reader.cancel();
        return "";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchOne(input: URL, signal: AbortSignal): Promise<string> {
  let target = input;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedUrl(target)) return "";
    const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const addresses = await resolvePublicAddresses(hostname, signal);
    if (!addresses) return "";

    // Pin the socket lookup to the public addresses that were validated above.
    // Each redirect gets a fresh validation and a fresh dispatcher.
    const dispatcher = new Agent({
      connections: 1,
      connect: {
        // Undici contextually types this callback as its socket DNS lookup
        // contract. This keeps the callback compatible with the installed
        // Node/Undici definitions while pinning it to validated addresses.
        lookup: (requestedHostname, options, callback) => {
          if (requestedHostname.toLowerCase() !== hostname) {
            callback(Object.assign(new Error("Unexpected DNS lookup host."), { code: "ENOTFOUND" }), "", 0);
            return;
          }
          const family = typeof options === "number" ? options : options.family;
          const candidates = addresses.filter((entry) => !family || entry.family === family);
          if (candidates.length === 0) {
            callback(Object.assign(new Error("No validated address for requested family."), { code: "ENOTFOUND" }), "", 0);
            return;
          }
          if (typeof options === "object" && options.all) {
            callback(null, candidates);
            return;
          }
          const selected = candidates[0]!;
          callback(null, selected.address, selected.family);
        },
      },
    });
    try {
      const response = await undiciFetch(target, {
        dispatcher,
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location || redirectCount === MAX_REDIRECTS) return "";
        try {
          target = new URL(location, target);
        } catch {
          return "";
        }
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return "";
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        return "";
      }
      return await readLimitedBody(response);
    } finally {
      await dispatcher.close().catch(() => {});
    }
  }
  return "";
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, header nav, footer nav").remove();
  const text = $("body").text() || $.root().text();
  return text.replace(/\s+/g, " ").trim();
}

export interface ScrapeResult {
  text: string;
  fetched: number;
  attempted: number;
  emails: string[];
  phones: string[];
}

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const US_PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;

function extractPhones(html: string): string[] {
  const $ = cheerio.load(html);
  const candidates = new Set<string>();
  $('a[href^="tel:"]').each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const number = href.replace(/^tel:/i, "").split(/[;,?]/)[0]?.trim();
    if (number) candidates.add(number);
  });
  const text = $.root().text();
  for (const match of text.match(US_PHONE_RE) ?? []) candidates.add(match.trim());
  const normalized = new Map<string, string>();
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, "");
    const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (tenDigits.length !== 10 || /^[01]/.test(tenDigits)) continue;
    if (!normalized.has(tenDigits)) normalized.set(tenDigits, raw);
  }
  return [...normalized.values()].slice(0, 5);
}

const PLACEHOLDER_LOCAL = new Set([
  "name",
  "email",
  "user",
  "yourname",
  "address",
  "anything",
  "johndoe",
  "janedoe",
]);
const PLACEHOLDER_DOMAIN_HINT = [
  "example.",
  "domain.",
  "yourdomain.",
  "test.",
  "wixpress.",
  "sentry.",
];

function extractEmails(text: string, targetDomain: string): string[] {
  const out = new Set<string>();
  const matches = text.match(EMAIL_RE) ?? [];
  for (const raw of matches) {
    const lower = raw.toLowerCase();
    if (/\.(?:png|jpe?g|svg|gif|webp)$/.test(lower)) continue;
    const at = lower.indexOf("@");
    if (at <= 0) continue;
    const local = lower.slice(0, at);
    const domain = lower.slice(at + 1);
    if (local.length < 2 || domain.length < 4) continue;
    if (PLACEHOLDER_LOCAL.has(local)) continue;
    if (PLACEHOLDER_DOMAIN_HINT.some((hint) => domain.includes(hint))) continue;
    out.add(lower);
  }
  const target = targetDomain.toLowerCase();
  return [...out].sort((a, b) => {
    const aLocal = a.endsWith(`@${target}`) ? 0 : 1;
    const bLocal = b.endsWith(`@${target}`) ? 0 : 1;
    return aLocal - bLocal;
  });
}

export function parseHomepageHtml(html: string, targetDomain: string): ScrapeResult {
  const text = htmlToText(html).slice(0, 12_000);
  return {
    text,
    fetched: html.length > 0 ? 1 : 0,
    attempted: 1,
    emails: extractEmails(html, targetDomain),
    phones: extractPhones(html),
  };
}

function emptyResult(): ScrapeResult {
  return { text: "", fetched: 0, attempted: 0, emails: [], phones: [] };
}

export async function fetchHomepageText(websiteUrl: string): Promise<ScrapeResult> {
  let base: URL;
  try {
    base = new URL(websiteUrl);
  } catch {
    return emptyResult();
  }
  if (!isAllowedUrl(base)) return emptyResult();
  const domain = base.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOMEPAGE_TIMEOUT_MS);
  const collected: string[] = [];

  try {
    for (const path of PATHS) {
      if (controller.signal.aborted) break;
      const target = new URL(path || "/", base);
      try {
        const html = await fetchOne(target, controller.signal);
        if (html) collected.push(html);
      } catch {
        // A failed optional page does not invalidate other pages.
      }
      if (collected.length >= 3) break;
    }
  } finally {
    clearTimeout(timeout);
  }

  const html = collected.join("\n");
  const parsed = parseHomepageHtml(html, domain);
  return { ...parsed, fetched: collected.length, attempted: PATHS.length };
}
