import type { ClientLead, UserProfile } from "../types";
import {
  discoverCompanies,
  personalizeOutreach,
  isGeminiConfigured,
  type DiscoveredCompany,
  type GroundingSource,
} from "./gemini";
import { fetchHomepageText } from "./scrape";
import { verifyEmail, type VerificationMethod } from "./verifyEmail";

const PIPELINE_CONCURRENCY = 2;
const STAGGER_MS = 400;

// Static city table used only to plot leads on the offline radar. No API.
// Lookup is substring-based against the discovered "City, State" string.
// Coordinates get a small random jitter so multiple leads in the same city
// don't overlap visually.
const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "san diego": { lat: 32.7157, lng: -117.1611 },
  "seattle": { lat: 47.6062, lng: -122.3321 },
  "portland": { lat: 45.5152, lng: -122.6784 },
  "denver": { lat: 39.7392, lng: -104.9903 },
  "phoenix": { lat: 33.4484, lng: -112.074 },
  "austin": { lat: 30.2672, lng: -97.7431 },
  "dallas": { lat: 32.7767, lng: -96.797 },
  "houston": { lat: 29.7604, lng: -95.3698 },
  "chicago": { lat: 41.8781, lng: -87.6298 },
  "atlanta": { lat: 33.749, lng: -84.388 },
  "miami": { lat: 25.7617, lng: -80.1918 },
  "boston": { lat: 42.3601, lng: -71.0589 },
  "new york": { lat: 40.7128, lng: -74.006 },
  "nyc": { lat: 40.7128, lng: -74.006 },
  "philadelphia": { lat: 39.9526, lng: -75.1652 },
  "washington": { lat: 38.9072, lng: -77.0369 },
  "minneapolis": { lat: 44.9778, lng: -93.265 },
  "nashville": { lat: 36.1627, lng: -86.7816 },
  "raleigh": { lat: 35.7796, lng: -78.6382 },
  "charlotte": { lat: 35.2271, lng: -80.8431 },
  "salt lake city": { lat: 40.7608, lng: -111.891 },
  "kansas city": { lat: 39.0997, lng: -94.5786 },
};

function resolveLocation(location: string): { lat?: number; lng?: number } {
  const norm = location.toLowerCase().trim();
  for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
    if (norm.includes(key)) {
      return {
        lat: coords.lat + (Math.random() - 0.5) * 0.15,
        lng: coords.lng + (Math.random() - 0.5) * 0.15,
      };
    }
  }
  return {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function inWaves<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  staggerMs: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (item, j) => {
        if (j > 0) await sleep(staggerMs * j);
        return worker(item, i + j);
      }),
    );
    results.forEach((r, j) => {
      out[i + j] = r;
    });
    if (i + concurrency < items.length) await sleep(staggerMs);
  }
  return out;
}

export interface PipelineParams {
  industry: string;
  location: string;
  tone: "professional" | "warm" | "direct" | "creative";
  companyScale?: string;
  techFocus?: string[];
  profile: UserProfile;
  count?: number;
  gatewayToken?: string;
}

export interface PipelineResult {
  leads: Omit<ClientLead, "id">[];
  sources: GroundingSource[];
  rawAnalysis: string;
  warnings: string[];
}

export async function runLeadPipeline(params: PipelineParams): Promise<PipelineResult> {
  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const discovered = await discoverCompanies({
    industry: params.industry,
    location: params.location,
    scale: params.companyScale,
    techFocus: params.techFocus,
    count: params.count ?? 8,
    gatewayToken: params.gatewayToken,
  });
  const companies: DiscoveredCompany[] = discovered.companies;
  const sources = discovered.sources;
  const rawText = discovered.rawText;

  if (companies.length === 0) {
    return {
      leads: [],
      sources,
      rawAnalysis: rawText,
      warnings: [...warnings, "Gemini returned no companies for this query."],
    };
  }

  const leads = await inWaves(
    companies,
    async (company): Promise<Omit<ClientLead, "id">> => {
      let homepageText = "";
      let scrapedEmails: string[] = [];
      let scrapedPhones: string[] = [];
      try {
        const scrape = await fetchHomepageText(company.website);
        homepageText = scrape.text;
        scrapedEmails = scrape.emails;
        scrapedPhones = scrape.phones;
      } catch (err) {
        warnings.push(`Scrape failed for ${company.name}: ${(err as Error).message}`);
      }

      let personalization;
      try {
        personalization = await personalizeOutreach({
          gatewayToken: params.gatewayToken,
          companyName: company.name,
          companyWebsite: company.website,
          companyDescription: company.description,
          homepageText,
          profile: params.profile,
          tone: params.tone,
          techFocus: params.techFocus ?? [],
        });
      } catch (err) {
        warnings.push(`Personalization failed for ${company.name}: ${(err as Error).message}`);
        personalization = {
          subject: `Engineering capacity for ${company.name}`,
          body: `Hi team,\n\nI specialize in ${params.profile.specialties.join(", ")} and would value a brief intro about engineering needs at ${company.name}.\n\nBest,\n${params.profile.fullName}`,
          potentialNeeds: [],
          suggestedStack: params.profile.specialties.slice(0, 4),
          contactPerson: "Business owner / decision-maker",
          smsBody: "Hi, this is " + params.profile.fullName + " with Teixido Labs. I had a quick idea related to " + company.name + "'s online presence. Is there a preferred business contact for a brief introduction?",
          coldCallScript: "Hi, this is " + params.profile.fullName + " with Teixido Labs. Did I catch you at an okay time? I was looking at " + company.name + "'s website and wanted to ask who handles your website and software projects. If relevant, I'd be glad to briefly introduce what we do.",
          voicemailScript: "Hi, this is " + params.profile.fullName + " with Teixido Labs calling for " + company.name + ". I'd welcome a brief conversation about your website or software needs. You can call me back when convenient. Thank you.",
        };
      }

      let contactEmail = "";
      let verificationMethod: VerificationMethod = "unverified";
      let emailVerified = false;

      if (scrapedEmails.length > 0) {
        contactEmail = scrapedEmails[0] ?? "";
        verificationMethod = "scraped";
      }

      if (contactEmail) {
        try {
          const v = await verifyEmail(contactEmail);
          verificationMethod = v.method;
          emailVerified = v.verified;
        } catch {
          /* keep scraped */
        }
      }

      const { lat, lng } = resolveLocation(company.location || params.location);

      return {
        name: company.name,
        website: company.website,
        industry: params.industry,
        location: company.location,
        latitude: lat,
        longitude: lng,
        description: company.description,
        potentialNeeds: personalization.potentialNeeds,
        suggestedStack: personalization.suggestedStack,
        contactEmail,
        contactPhone: scrapedPhones[0] ?? "",
        smsTemplate: personalization.smsBody,
        coldCallScript: personalization.coldCallScript,
        voicemailScript: personalization.voicemailScript,
        emailVerified,
        verificationMethod,
        contactPerson: personalization.contactPerson,
        outreachTemplate: `Subject: ${personalization.subject}\n\n${personalization.body}`,
        status: "Lead",
        notes: company.reason,
        dateAdded: today,
        source: "Search AI",
      };
    },
    PIPELINE_CONCURRENCY,
    STAGGER_MS,
  );

  return { leads, sources, rawAnalysis: rawText, warnings };
}
