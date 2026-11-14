import { GoogleGenAI } from "@google/genai";
import type { UserProfile } from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL ?? "inclusionai/ling-3.1-flash-free";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

let cached: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI | null {
  if (cached) return cached;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  cached = new GoogleGenAI({ apiKey: key });
  return cached;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function isGatewayConfigured(requestToken?: string): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || requestToken || process.env.VERCEL_OIDC_TOKEN);
}

async function generateWithGateway(prompt: string, requestToken?: string): Promise<string> {
  const token = process.env.AI_GATEWAY_API_KEY || requestToken || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error("Vercel AI Gateway auth is missing. Enable Vercel OIDC or set AI_GATEWAY_API_KEY for local development.");
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GATEWAY_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.5 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("Vercel AI Gateway request failed (" + response.status + "): " + (await response.text()).slice(0, 500));
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  throw new Error("Vercel AI Gateway returned no text content.");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export interface DiscoveredCompany {
  name: string;
  website: string;
  location: string;
  description: string;
  reason: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface DiscoverResult {
  companies: DiscoveredCompany[];
  sources: GroundingSource[];
  rawText: string;
}

const JSON_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i;

function extractJsonArray(text: string): unknown[] {
  const fenceMatch = text.match(JSON_BLOCK);
  const candidate = (fenceMatch?.[1] ?? text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function discoverFromPublicSearch(params: { industry: string; location: string; count: number }): Promise<DiscoverResult> {
  const query = encodeURIComponent(params.industry + " businesses in " + params.location + " official website");
  const response = await fetch("https://html.duckduckgo.com/html/?q=" + query, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ClientLeadFinder/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Public search failed (" + response.status + ").");
  const html = await response.text();
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  const companies: DiscoveredCompany[] = [];
  const sources: GroundingSource[] = [];
  const seen = new Set<string>();
  const skip = /duckduckgo|google\.|bing\.com|yelp\.|yellowpages|linkedin\.com|facebook\.com|instagram\.com|mapquest|tripadvisor|wikipedia\.org/i;
  $(".result").each((_, element) => {
    if (companies.length >= params.count) return;
    const anchor = $(element).find(".result__title a").first();
    const title = anchor.text().trim();
    let href = anchor.attr("href") || "";
    try { const parsed = new URL(href, "https://html.duckduckgo.com"); href = parsed.searchParams.get("uddg") || href; } catch { return; }
    try {
      const parsed = new URL(href);
      const host = parsed.hostname.replace(/^www\./, "");
      const description = $(element).find(".result__snippet").text().trim();
      if (!["http:", "https:"].includes(parsed.protocol) || skip.test(host) || seen.has(host) || !title || !description) return;
      seen.add(host);
      companies.push({
        name: title.replace(/\s+[|–-]\s+.*$/, "").trim(),
        website: parsed.origin, location: params.location, description: description.slice(0, 360),
        reason: "Public search result. Confirm fit and contact details before outreach.",
      });
      sources.push({ title, uri: href });
    } catch { /* skip malformed result */ }
  });
  return { companies, sources: sources.slice(0, 12), rawText: companies.map(c => "- " + c.name + " | " + c.website + " | " + c.description).join("\\n") };
}

async function discoverWithGateway(params: { industry: string; location: string; scale?: string; techFocus?: string[]; count: number }, requestToken?: string): Promise<DiscoverResult> {
  const scaleHint = params.scale && params.scale !== "any" ? `Prefer ${params.scale} (over enterprises).` : "";
  const techHint = params.techFocus?.length ? `Relevant services: ${params.techFocus.join(", ")}.` : "";
  const prompt = `Find ${params.count} real local businesses in ${params.location} in this category: ${params.industry}.
${scaleHint} ${techHint}
Return only a JSON array with objects {name, website, location, description, reason}. Use official business websites, not directories or social networks. Do not invent businesses or URLs. Prefer companies where website modernization, online booking, lead capture, or workflow automation may be relevant. Include only entries with a plausible official homepage URL.`;
  const rawText = await generateWithGateway(prompt, requestToken);
  const items = extractJsonArray(rawText);
  const companies: DiscoveredCompany[] = items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(item => ({
      name: typeof item.name === "string" ? item.name : "",
      website: typeof item.website === "string" ? item.website : "",
      location: typeof item.location === "string" ? item.location : params.location,
      description: typeof item.description === "string" ? item.description : "",
      reason: typeof item.reason === "string" ? item.reason : "AI-discovered prospect; verify website evidence before outreach.",
    }))
    .filter(c => c.name && /^https?:\/\//i.test(c.website))
    .slice(0, params.count);
  return { companies, sources: [], rawText };
}

export async function discoverCompanies(params: {
  industry: string;
  location: string;
  scale?: string;
  techFocus?: string[];
  count?: number;
  gatewayToken?: string;
}): Promise<DiscoverResult> {
  const gemini = getGemini();
  const count = Math.min(Math.max(params.count ?? 8, 1), 12);
  if (!gemini) {
    if (isGatewayConfigured(params.gatewayToken)) {
      try {
        const result = await discoverWithGateway({ ...params, count }, params.gatewayToken);
        if (result.companies.length) return result;
      } catch {
        // Preserve independent public-search fallback if model access fails.
      }
    }
    return discoverFromPublicSearch({ industry: params.industry, location: params.location, count });
  }
  const scaleHint =
    params.scale && params.scale !== "any"
      ? `Prefer ${params.scale} (over enterprises).`
      : "";
  const techHint =
    params.techFocus && params.techFocus.length > 0
      ? `These tech stacks are relevant: ${params.techFocus.join(", ")}.`
      : "";

  const prompt = `Use Google Search to find ${count} REAL ${params.industry} companies in ${params.location} that a freelance software engineer could pitch services to.

${scaleHint} ${techHint}

Return ONLY a JSON array with this exact shape. No prose, no markdown fences:
[
  {
    "name": "Company Name",
    "website": "https://example.com",
    "location": "City, State",
    "description": "One-sentence description of what they do.",
    "reason": "Why they're a good outreach target (their tech focus, growth stage, or specific need)."
  }
]

Rules:
- Use only verifiable companies. Don't invent names.
- "website" must be the official homepage URL with https://.
- Skip aggregators (Yelp, Yellowpages, LinkedIn directories).
- Skip Fortune-50 enterprises unless explicitly asked.
- If you cannot find ${count}, return whatever you can verify, even if fewer.`;

  const response = await gemini.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.4,
    },
  });

  const rawText = response.text ?? "";
  const items = extractJsonArray(rawText);
  const companies: DiscoveredCompany[] = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      website: typeof item.website === "string" ? item.website : "",
      location: typeof item.location === "string" ? item.location : params.location,
      description: typeof item.description === "string" ? item.description : "",
      reason: typeof item.reason === "string" ? item.reason : "",
    }))
    .filter((c) => c.name && c.website);

  const groundingMetadata =
    response.candidates?.[0]?.groundingMetadata ?? undefined;
  const chunks = groundingMetadata?.groundingChunks ?? [];
  const sources: GroundingSource[] = chunks
    .map((chunk): GroundingSource | null => {
      const web = chunk.web;
      if (!web || !web.uri) return null;
      return { title: web.title ?? web.uri, uri: web.uri };
    })
    .filter((s): s is GroundingSource => s !== null)
    .slice(0, 8);

  return { companies, sources, rawText };
}

export interface PersonalizationInput {
  gatewayToken?: string;
  companyName: string;
  companyWebsite: string;
  companyDescription: string;
  homepageText: string;
  profile: UserProfile;
  tone: "professional" | "warm" | "direct" | "creative";
  techFocus: string[];
}

export interface PersonalizationOutput {
  subject: string;
  body: string;
  potentialNeeds: string[];
  suggestedStack: string[];
  contactPerson: string;
  smsBody: string;
  coldCallScript: string;
  voicemailScript: string;
}

const TONE_GUIDANCE: Record<PersonalizationInput["tone"], string> = {
  professional: "Polished, formal, third-person business voice.",
  warm: "Friendly and conversational; first-person; ends with a soft ask.",
  direct: "Crisp; no fluff; opens with the value proposition.",
  creative: "Distinctive opening; metaphor allowed; still business-appropriate.",
};

export async function personalizeOutreach(input: PersonalizationInput): Promise<PersonalizationOutput> {
  if (!isGatewayConfigured(input.gatewayToken)) {
    const name = input.companyName;
    const needs = ["website modernization", "lead capture", "workflow automation"];
    const website = input.companyWebsite || "your website";
    const sender = input.profile.fullName.trim();
    const signature = sender ? "\n\nBest,\n" + sender : "";
    const introduction = sender
      ? "I’m " + sender + ", and I’m reaching out with a practical idea: " + needs[0] + "."
      : "I’m reaching out with a practical idea: " + needs[0] + ".";
    return {
      subject: "A practical improvement idea for " + name,
      body: "Hi there,\n\nI was researching " + name + " and wanted to share a practical idea. For local service businesses, improving " + website + " and the path from visitor to enquiry can reduce missed opportunities without adding admin work.\n\n" + introduction + " I build custom websites, software, and automation around the way a business actually operates. If improving this is on your radar, I’d be happy to share a couple of concrete ideas after a closer look at your current setup." + signature,
      potentialNeeds: needs,
      suggestedStack: ["Modern responsive website", "Lead capture and follow-up automation", "Booking / CRM integration"],
      contactPerson: "Business owner",
      smsBody: "Hello, I had an idea that may help " + name + " improve website enquiries and reduce admin. Is there a good person to share it with? Please let me know if texts aren’t welcome.",
      coldCallScript: "Hello, I had a practical idea that may help " + name + " improve website enquiries and reduce admin work. Is now a good time to briefly explain it, or is there someone else I should contact? If it is not relevant, I will not follow up.",
      voicemailScript: "Hello, I’m reaching out with a practical idea that may help " + name + " improve " + needs[0] + ". If this is relevant, please use the contact details supplied in my message to get back to me. Thanks."
    };
  }

  const trimmedHomepage = input.homepageText.slice(0, 6000);
  const specialties = input.profile.specialties.join(", ");
  const techHint =
    input.techFocus.length > 0 ? input.techFocus.join(", ") : specialties;

  const prompt = `You are drafting a cold outreach email from a freelance software engineer to a prospective client.

SENDER PROFILE:
- Name: ${input.profile.fullName}
- Title: ${input.profile.title}
- Specialties: ${specialties}
- Rate/positioning: ${input.profile.customRate}
- Portfolio: ${input.profile.portfolioUrl}

TARGET COMPANY:
- Name: ${input.companyName}
- Website: ${input.companyWebsite}
- Public summary: ${input.companyDescription || "(none)"}

THEIR HOMEPAGE TEXT (truncated to 6kB):
"""
${trimmedHomepage || "(could not fetch homepage — base personalization on the public summary only)"}
"""

TASK:
Write a cold-outreach email tailored to THIS company. Reference at least one specific thing from their homepage text (a product line, a value prop, a recent announcement). Do not hallucinate facts not present in the text. Avoid corporate buzzwords.

TONE: ${input.tone}. ${TONE_GUIDANCE[input.tone]}

Also return:
- 3 "potentialNeeds" — concrete engineering problems THIS company likely has, inferred from their site
- A "suggestedStack" of 3-6 technologies that match the sender's specialties (${techHint}) AND make sense for their domain
- A "contactPerson" — a role title likely to receive this (e.g. "Owner", "Operations Manager", "Director of Engineering"). If the homepage names a real person in a relevant role, use their name.
- "smsBody" — a respectful first-contact text under 320 characters, for manual review only; do not imply permission to text exists
- "coldCallScript" — a natural 20–35 second opener, identify the caller using only sender details explicitly supplied in the profile, do not invent a company identity, ask whether this is a good time, and use only supported evidence
- "voicemailScript" — a concise voicemail under 25 seconds with a callback invitation and no fabricated claims

Output strictly the JSON object described in the response schema. No prose. Sign the email body with the sender name above. Never invent a person's name, phone number, business fact, or prior relationship.`;

  const text = await generateWithGateway(prompt + "\n\nReturn only one valid JSON object with keys: subject, body, potentialNeeds (array), suggestedStack (array), contactPerson, smsBody, coldCallScript, voicemailScript. Do not wrap it in Markdown.", input.gatewayToken);
  const parsed = parseJsonObject(text) as Partial<PersonalizationOutput>;

  return {
    subject: parsed.subject ?? `Engineering capacity for ${input.companyName}`,
    body:
      parsed.body ??
      `Hi team,\n\nI specialize in ${specialties} and would love to chat about engineering needs at ${input.companyName}.\n\nBest,\n${input.profile.fullName}`,
    potentialNeeds: Array.isArray(parsed.potentialNeeds) ? parsed.potentialNeeds : [],
    suggestedStack: Array.isArray(parsed.suggestedStack)
      ? parsed.suggestedStack
      : input.profile.specialties.slice(0, 4),
    contactPerson: parsed.contactPerson ?? "Business owner / decision-maker",
    smsBody: parsed.smsBody ?? ("Hello, I had a quick idea related to " + input.companyName + "'s online presence. Is there a preferred business contact for a brief introduction?"),
    coldCallScript: parsed.coldCallScript ?? ("Hello, did I catch you at an okay time? I was looking at " + input.companyName + "'s website and wanted to ask who handles your website and software projects. If relevant, I'd be glad to briefly explain the idea."),
    voicemailScript: parsed.voicemailScript ?? ("Hello, I’m calling with a practical idea for " + input.companyName + ". I’d welcome a brief conversation about your website or software needs. Please use the contact details provided in the accompanying message if you would like to discuss it. Thank you."),
  };
}

export interface PitchStrategyInput {
  gatewayToken?: string;
  companyName: string;
  suggestedStack: string[];
  customExperience: string;
  homepageText: string;
}

export async function generatePitchStrategy(input: PitchStrategyInput): Promise<string> {
  if (!isGatewayConfigured(input.gatewayToken)) {
    const evidence = input.homepageText.trim()
      ? "Website text is available; verify every claim against the source."
      : "No homepage text was retrieved; avoid claims about specific site features.";
    return "## Likely opportunity areas\n- Review whether services, service area, and contact options are easy to find.\n- Check whether enquiries can be captured and followed up without manual copying.\n- Confirm whether booking or repetitive admin could be simplified.\n\n## Positioning\n- Offer a focused website improvement before suggesting a wholesale rebuild.\n- Explore lead-capture and follow-up automation after confirming the actual problem.\n\n## Discovery questions\n- How do new enquiries arrive and who follows up?\n- Which repetitive admin task takes the most time each week?\n- What would you most like the website to do better?\n\n## Evidence note\n" + evidence;
  }

  const trimmed = input.homepageText.slice(0, 4000);
  const prompt = `Write a "Winning Pitch Strategy" in concise Markdown for an outreach call with ${input.companyName}.

Sender's relevant background: ${input.customExperience}
Sender's likely stack: ${input.suggestedStack.join(", ")}

Target company homepage excerpt (may be empty):
"""
${trimmed}
"""

Produce 4 short sections:
1. **Their likely engineering bottlenecks** — 2-3 bullets grounded in the homepage text (or a note that the text is empty).
2. **How to position the sender's stack** — 2-3 bullets matching stack to bottlenecks.
3. **Discovery questions** — 3 questions that surface the real problem in the first call.
4. **Closing angle** — one paragraph on the differentiator.

Keep it under 300 words. Use plain language, no buzzwords.`;

  return await generateWithGateway(prompt, input.gatewayToken);
}
