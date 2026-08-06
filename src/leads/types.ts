import type { TaskPlan } from "../core/types.js";

export type LeadMode = "freelance" | "business";

export type LeadStatus = "new" | "saved" | "dismissed" | "contacted" | "qualified" | "converted" | "won" | "lost" | "not_interested";

export type LeadSearchStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "canceled";

export type FreelanceProjectType = "fixed_price" | "hourly" | "both";

export type FreelancePlatform = "freelancer" | "upwork" | "search";

export type BusinessProfileId = "getsparkd" | "nutra_vida";

export interface FreelanceSearchCriteria {
  objective: string;
  keywords: string[];
  skills: string[];
  platforms: FreelancePlatform[];
  minBudget?: number | undefined;
  maxBudget?: number | undefined;
  budgetType: FreelanceProjectType;
  minHourlyRate?: number | undefined;
  preferredTechnologies: string[];
  projectTypes: string[];
  locationRequirements?: string | undefined;
  remotePreference?: "remote" | "hybrid" | "onsite" | "any";
  additionalInstructions?: string | undefined;
  maxLeads: number;
}

export interface BusinessSearchCriteria {
  profileId: BusinessProfileId;
  location: string;
  radiusMiles?: number | undefined;
  businessTypes: string[];
  industries: string[];
  keywords: string[];
  targetCustomer?: string | undefined;
  companySize?: string | undefined;
  websiteRequired?: boolean | undefined;
  socialPresenceRequired?: boolean | undefined;
  additionalCriteria?: string | undefined;
  maxLeads: number;
}

export interface LeadReasonBreakdown {
  technicalFitScore?: number;
  budgetFitScore?: number;
  clientQualityScore?: number;
  competitionScore?: number;
  fitScore?: number;
  qualificationScore?: number;
  opportunityScore?: number;
  overallScore: number;
  label: string;
}

export interface FreelancerBudgetDetails {
  type: "fixed" | "hourly" | "unknown";
  min?: number | undefined;
  max?: number | undefined;
  currency?: string | undefined;
  raw?: string | undefined;
}

export interface FreelancerClientDetails {
  name?: string | undefined;
  rating?: number | undefined;
  reviewCount?: number | undefined;
  hireRate?: number | undefined;
  totalSpend?: number | undefined;
  location?: string | undefined;
  verified?: boolean | undefined;
}

export interface FreelancerSourceMetadata {
  provider: "freelancer";
  discoveryUrl: string;
  projectUrl: string;
  extractedAt: string;
  extractionMethod: string;
}

export interface FreelanceLead {
  kind: "freelance";
  id: string;
  platform: string;
  title: string;
  url: string;
  description?: string | undefined;
  summary: string;
  budget?: string | undefined;
  budgetType?: "fixed" | "hourly" | "unknown" | undefined;
  budgetDetails?: FreelancerBudgetDetails | undefined;
  hourlyRate?: string | undefined;
  skills: string[];
  clientName?: string | undefined;
  clientLocation?: string | undefined;
  clientRating?: string | undefined;
  clientReviewCount?: number | undefined;
  clientSpend?: string | undefined;
  clientHireRate?: string | undefined;
  projectAge?: string | undefined;
  competitionCount?: number | undefined;
  bidCount?: number | undefined;
  client?: FreelancerClientDetails | undefined;
  technicalFitScore: number;
  budgetFitScore: number;
  clientQualityScore: number;
  competitionScore: number;
  overallScore: number;
  scoreLabel: string;
  recommendedBid?: string | undefined;
  recommendedApproach: string;
  reasonForRecommendation: string;
  discoveredAt: string;
  status: LeadStatus;
  sourceQuery: string;
  sourceUrl?: string;
  source?: FreelancerSourceMetadata | undefined;
}

export interface BusinessLead {
  kind: "business";
  id: string;
  businessName: string;
  businessType: string;
  industry: string;
  website?: string | undefined;
  url?: string | undefined;
  location?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  socialProfiles: string[];
  description?: string | undefined;
  services: string[];
  employeeCount?: string | undefined;
  source: string;
  qualificationScore: number;
  fitScore: number;
  opportunityScore: number;
  overallScore: number;
  scoreLabel: string;
  reasonForRecommendation: string;
  potentialNeed: string;
  recommendedOffer: string;
  discoveredAt: string;
  status: LeadStatus;
  sourceQuery: string;
}

export type Lead = FreelanceLead | BusinessLead;

export interface LeadSearchEvent {
  id: string;
  at: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LeadSearchRecord {
  id: string;
  mode: LeadMode;
  title: string;
  status: LeadSearchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  criteria: FreelanceSearchCriteria | BusinessSearchCriteria;
  planSnapshot: TaskPlan;
  events: LeadSearchEvent[];
  results: Lead[];
  summary: string;
  error?: string;
  savedWorkflowId?: string;
  observability?: {
    provider?: string;
    discoveryUrls?: string[];
    pagesVisited?: number;
    projectsDiscovered?: number;
    projectsExtracted?: number;
    projectsValidated?: number;
    duplicatesRemoved?: number;
    budgetFiltered?: number;
    finalLeadCount?: number;
  };
}

export interface LeadSearchRequest {
  mode: LeadMode;
  criteria: FreelanceSearchCriteria | BusinessSearchCriteria;
}

export interface LeadSearchRun {
  record: LeadSearchRecord;
  stop: () => void;
}
