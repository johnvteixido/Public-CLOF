export type VerificationMethod =
  | 'rcpt'
  | 'mx-only'
  | 'scraped'
  | 'pattern'
  | 'unverified';

export interface ClientLead {
  id: string;
  name: string;
  website: string;
  industry: string;
  location: string;
  description: string;
  potentialNeeds: string[];
  suggestedStack: string[];
  contactEmail: string;
  contactPhone?: string;
  smsTemplate?: string;
  coldCallScript?: string;
  voicemailScript?: string;
  emailVerified?: boolean;
  verificationMethod?: VerificationMethod;
  contactPerson?: string;
  outreachTemplate: string;
  status: 'Lead' | 'Contacted' | 'In Discussion' | 'Replied' | 'Declined' | 'Archived';
  notes: string;
  dateAdded: string;
  source: 'Search AI' | 'Manual';
  latitude?: number;
  longitude?: number;
}

export interface SearchQuery {
  industry: string;
  location: string;
  companyScale: string; // 'startups' | 'local businesses' | 'mid-market' | 'any'
  techFocus: string[];
  customCriteria?: string;
  maxResults?: number;
  crawlerMode?: 'standard' | 'deep' | 'maps_scraper';
  profile?: UserProfile;
}

export interface UserProfile {
  fullName: string;
  title: string;
  portfolioUrl: string;
  email: string;
  specialties: string[];
  customRate: string;
  physicalAddress?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface GenerateLeadsResponse {
  leads: ClientLead[];
  groundingSources: GroundingSource[];
  rawAnalysis: string;
}
