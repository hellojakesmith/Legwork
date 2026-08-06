import { createHash } from "node:crypto";
import { nowIso } from "../shared/time.js";
import type { FreelanceLead, FreelanceSearchCriteria, FreelancerBudgetDetails, FreelancerClientDetails, FreelancerSourceMetadata } from "./types.js";

export interface FreelancerSearchMetrics {
  provider: "freelancer";
  discoveryUrls: string[];
  pagesVisited: number;
  projectsDiscovered: number;
  projectsExtracted: number;
  projectsValidated: number;
  duplicatesRemoved: number;
  budgetFiltered: number;
  finalLeadCount: number;
}

export interface FreelancerSearchResult {
  leads: FreelanceLead[];
  metrics: FreelancerSearchMetrics;
  failureMessage?: string;
}

export interface FreelancerSearchOptions {
  fetchHtml?: (url: string) => Promise<string>;
  discoveryUrls?: string[];
  maxDiscoveryUrls?: number;
}

interface FreelancerSearchCard {
  title: string;
  url: string;
  description: string;
  budget?: string;
  skills: string[];
  daysLeft?: string;
  bidCount?: number;
  verified?: boolean;
  discoveryUrl: string;
}

interface FreelancerProjectDocument {
  projectId?: number;
  title?: string;
  description?: string;
  formattedBudget?: string;
  budget?: { min?: number; max?: number };
  type?: "fixed" | "hourly" | string;
  skills?: Array<{ name?: string; seoUrl?: string } | string>;
  bidStats?: { bidCount?: number; bidAvg?: number };
  client?: {
    address?: { city?: string; country?: string; countryCode?: string };
    rating?: { average?: number; reviewCount?: number };
    verification?: {
      paymentVerified?: boolean;
      emailVerified?: boolean;
      profileComplete?: boolean;
      phoneVerified?: boolean;
      depositMade?: boolean;
    };
  };
  daysLeft?: number;
  hoursLeft?: number;
  latestActivityTime?: number;
  status?: string;
  subStatus?: string;
  seoUrl?: string;
}

interface NormalizedFreelancerCandidate {
  title: string;
  url: string;
  description: string;
  summary: string;
  budget?: string;
  budgetDetails?: FreelancerBudgetDetails;
  hourlyRate?: string;
  skills: string[];
  clientName?: string;
  clientLocation?: string;
  clientRating?: string;
  clientReviewCount?: number;
  clientSpend?: string;
  clientHireRate?: string;
  projectAge?: string;
  competitionCount?: number;
  bidCount?: number;
  client?: FreelancerClientDetails;
  sourceQuery: string;
  sourceUrl: string;
  projectId?: string;
  source: FreelancerSourceMetadata;
}

const FREELANCER_ORIGIN = "https://www.freelancer.com";

const FREELANCER_SKILL_MAP: Record<string, string> = {
  "node.js": "nodejs",
  "nodejs": "nodejs",
  "node js": "nodejs",
  typescript: "typescript",
  "react.js": "react-js",
  reactjs: "react-js",
  react: "react-js",
  "next.js": "next-js",
  nextjs: "next-js",
  api: "api",
  "api integration": "api",
  "api integrations": "api",
  automation: "automation",
  "ai automation": "artificial-intelligence",
  ai: "artificial-intelligence",
  saas: "saas",
  javascript: "javascript",
  python: "python",
  express: "express",
  mongodb: "mongodb",
  postgres: "postgresql",
  postgresql: "postgresql",
  "react native": "react-native",
  flutter: "flutter",
  laravel: "laravel",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "));
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name: string) => named[name.toLowerCase()] ?? `&${name};`);
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeFreelancerSkill(value: string): string {
  const key = normalizeWhitespace(value).toLowerCase();
  return FREELANCER_SKILL_MAP[key] ?? normalizeWhitespace(value);
}

function normalizeSkills(values: Array<string | { name?: string; seoUrl?: string }> = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const raw = typeof value === "string" ? value : value.name ?? value.seoUrl ?? "";
    const normalized = normalizeFreelancerSkill(raw);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isFreelancerDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "freelancer.com" || parsed.hostname.endsWith(".freelancer.com");
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url, FREELANCER_ORIGIN);
  parsed.hash = "";
  parsed.search = "";
  return parsed.href.replace(/\/$/, "");
}

function isProjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url, FREELANCER_ORIGIN);
    return isFreelancerDomain(parsed.href) && parsed.pathname.startsWith("/projects/") && !/\/(job-search|jobs|users|login|signup|post-project|enterprise|freelancer\.com)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeProjectKey(url: string): string {
  const parsed = new URL(url, FREELANCER_ORIGIN);
  return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
}

function parseDuration(value?: number, fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value === 0) return "Today";
  if (value > 0) return `${Math.abs(value)} days left`;
  return undefined;
}

function parseBudgetFromDocument(doc: FreelancerProjectDocument): FreelancerBudgetDetails | undefined {
  const raw = doc.formattedBudget?.trim();
  const fixedRange = doc.budget?.min !== undefined || doc.budget?.max !== undefined;
  const type = doc.type === "hourly" ? "hourly" : doc.type === "fixed" || fixedRange ? "fixed" : "unknown";

  if (!raw && !fixedRange && type === "unknown") {
    return undefined;
  }

  return {
    type,
    min: doc.budget?.min,
    max: doc.budget?.max,
    currency: raw?.match(/([A-Z]{3}|USD|AUD|CAD|EUR|GBP|INR|PHP|SGD|NZD|MXN|BRL)/)?.[1] ?? "USD",
    raw,
  };
}

function parseClientFromDocument(doc: FreelancerProjectDocument): FreelancerClientDetails | undefined {
  const rating = doc.client?.rating?.average;
  const reviewCount = doc.client?.rating?.reviewCount;
  const verified = Boolean(
    doc.client?.verification?.paymentVerified ||
      doc.client?.verification?.emailVerified ||
      doc.client?.verification?.phoneVerified ||
      doc.client?.verification?.profileComplete ||
      doc.client?.verification?.depositMade,
  );
  const location = [doc.client?.address?.city, doc.client?.address?.country].filter(Boolean).join(", ") || undefined;
  if (rating === undefined && reviewCount === undefined && !location && !verified) {
    return undefined;
  }
  return {
    rating,
    reviewCount,
    location,
    verified,
  };
}

function extractBalancedJson(source: string, startIndex: number): string | undefined {
  if (startIndex < 0 || startIndex >= source.length || source[startIndex] !== "{") {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function extractProjectDocument(html: string, projectPath: string): FreelancerProjectDocument | undefined {
  const key = `"${projectPath}":{"rawDocument":`;
  const marker = html.indexOf(key);
  if (marker < 0) {
    return undefined;
  }

  const rawStart = html.indexOf("{", marker + key.length - 1);
  const rawJson = extractBalancedJson(html, rawStart);
  if (!rawJson) {
    return undefined;
  }

  try {
    return JSON.parse(rawJson) as FreelancerProjectDocument;
  } catch {
    return undefined;
  }
}

function extractMetaContent(html: string, name: string): string | undefined {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  return decodeHtmlEntities(firstMatch(html, pattern) ?? "");
}

function extractSearchCards(html: string, discoveryUrl: string): FreelancerSearchCard[] {
  const headingRegex = /<a[^>]+href="([^"]+)"[^>]+class="JobSearchCard-primary-heading-link"[^>]*>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(headingRegex)];
  const cards: FreelancerSearchCard[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const segment = html.slice(match.index ?? 0, next?.index ?? html.length);
    const url = normalizeUrl(match[1]);
    const title = normalizeWhitespace(stripTags(match[2]));
    const description = normalizeWhitespace(stripTags(firstMatch(segment, /<p class="JobSearchCard-primary-description">([\s\S]*?)<\/p>/i) ?? ""));
    const budget = normalizeWhitespace(stripTags(firstMatch(segment, /<div class="JobSearchCard-(?:primary|secondary)-price">([\s\S]*?)(?:<span[^>]*>(?:Average bid|Avg Bid)<\/span>|<\/div>)/i) ?? ""));
    const tags = [...segment.matchAll(/<a class="JobSearchCard-primary-tagsLink" href="[^"]+">([\s\S]*?)<\/a>/g)]
      .map((tag) => normalizeFreelancerSkill(normalizeWhitespace(stripTags(tag[1]))))
      .filter(Boolean);
    const bidCount = toNumber(firstMatch(segment, /(\d[\d,]*)\s*bids?/i));
    const verified = /\bVerified\b/i.test(segment);
    const daysLeft = normalizeWhitespace(stripTags(firstMatch(segment, /JobSearchCard-primary-heading-days">([\s\S]*?)<\/div>/i) ?? ""));

    if (!isProjectUrl(url)) {
      continue;
    }

    cards.push({
      title,
      url,
      description,
      budget: budget || undefined,
      skills: Array.from(new Set(tags)),
      daysLeft: daysLeft || undefined,
      bidCount,
      verified,
      discoveryUrl,
    });
  }

  return cards;
}

function buildDiscoveryKeywordList(criteria: FreelanceSearchCriteria): string[] {
  const candidates = [
    ...criteria.skills,
    ...criteria.preferredTechnologies,
    ...criteria.keywords,
    ...normalizeWhitespace(criteria.objective)
      .split(/[\s,()/]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  ];

  const preferred = candidates
    .map((candidate) => normalizeFreelancerSkill(candidate))
    .map((candidate) => candidate.toLowerCase())
    .map((candidate) => FREELANCER_SKILL_MAP[candidate] ?? candidate)
    .filter(Boolean);

  const unique = Array.from(new Set(preferred));
  return unique.slice(0, 4);
}

export function buildFreelancerDiscoveryUrls(criteria: FreelanceSearchCriteria, maxDiscoveryUrls = 4): string[] {
  const preferred = buildDiscoveryKeywordList(criteria);
  const slugs = preferred
    .map((term) => term.toLowerCase())
    .map((term) => FREELANCER_SKILL_MAP[term] ?? term)
    .map((term) => term.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);

  const urls = slugs.length > 0 ? slugs.map((slug) => `${FREELANCER_ORIGIN}/jobs/${slug}`) : [`${FREELANCER_ORIGIN}/job-search/`];
  return Array.from(new Set(urls)).slice(0, Math.max(1, maxDiscoveryUrls));
}

function buildSourceMetadata(projectUrl: string, discoveryUrl: string, extractionMethod: string): FreelancerSourceMetadata {
  return {
    provider: "freelancer",
    discoveryUrl,
    projectUrl,
    extractedAt: nowIso(),
    extractionMethod,
  };
}

function normalizeCandidate(card: FreelancerSearchCard, discoveryUrl: string, projectDoc: FreelancerProjectDocument): NormalizedFreelancerCandidate | undefined {
  const url = normalizeUrl(card.url);
  if (!isProjectUrl(url)) {
    return undefined;
  }

  const title = normalizeWhitespace(projectDoc.title ?? card.title);
  const description = normalizeWhitespace(projectDoc.description ?? card.description);
  const summary = normalizeWhitespace(card.description || projectDoc.description || title);
  const skills = normalizeSkills(projectDoc.skills ?? card.skills);
  const budgetDetails = parseBudgetFromDocument(projectDoc);
  const budget = budgetDetails?.raw || card.budget;
  const client = parseClientFromDocument(projectDoc);
  const projectAge = parseDuration(projectDoc.daysLeft ?? undefined, card.daysLeft);
  const bidCount = projectDoc.bidStats?.bidCount ?? card.bidCount;
  const projectId = projectDoc.projectId ? String(projectDoc.projectId) : undefined;
  const hourlyRate = budgetDetails?.type === "hourly" ? budgetDetails.raw : undefined;
  const source = buildSourceMetadata(url, discoveryUrl, "freelancer-search-card+project-page");

  return {
    title,
    url,
    description,
    summary,
    budget,
    budgetDetails,
    hourlyRate,
    skills,
    clientName: undefined,
    clientLocation: client?.location,
    clientRating: client?.rating !== undefined ? `${client.rating.toFixed(1)} / 5` : undefined,
    clientReviewCount: client?.reviewCount,
    clientSpend: undefined,
    clientHireRate: undefined,
    projectAge,
    competitionCount: bidCount,
    bidCount,
    client,
    sourceQuery: discoveryUrl,
    sourceUrl: url,
    projectId,
    source,
  };
}

function projectFingerprint(candidate: NormalizedFreelancerCandidate): string {
  return createHash("sha1")
    .update(
      [
        candidate.projectId ?? "",
        normalizeUrl(candidate.url),
        candidate.title.toLowerCase(),
        candidate.budgetDetails?.raw ?? candidate.budget ?? "",
        candidate.description.toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

function isLikelyFreelancerProjectTitle(title: string, criteria: FreelanceSearchCriteria): boolean {
  const normalized = normalizeWhitespace(title).toLowerCase();
  if (!normalized || normalized.length < 8) {
    return false;
  }
  if (/freelancer|job search|browse jobs|projects? for|jobs for/i.test(normalized)) {
    return false;
  }

  const objective = normalizeWhitespace(criteria.objective).toLowerCase();
  if (normalized === objective) {
    return false;
  }

  const searchTokens = [...criteria.skills, ...criteria.preferredTechnologies, ...criteria.keywords]
    .map((token) => normalizeWhitespace(token).toLowerCase())
    .filter(Boolean);
  if (searchTokens.length > 0 && searchTokens.every((token) => normalized.includes(token))) {
    return false;
  }

  return true;
}

function passesBudgetFilter(candidate: NormalizedFreelancerCandidate, criteria: FreelanceSearchCriteria): boolean {
  if (!criteria.minBudget && !criteria.maxBudget && !criteria.minHourlyRate) {
    return true;
  }

  const budget = candidate.budgetDetails;
  if (!budget || budget.type === "unknown") {
    return false;
  }

  const minBudget = criteria.minBudget ?? 0;
  const maxBudget = criteria.maxBudget ?? Number.POSITIVE_INFINITY;
  const minHourlyRate = criteria.minHourlyRate ?? 0;

  const lowerBound = budget.min ?? toNumber(candidate.budget?.match(/(\d[\d,]*)/)?.[1]);
  const upperBound = budget.max ?? lowerBound;

  if (budget.type === "hourly") {
    const hourly = upperBound ?? lowerBound;
    if (hourly === undefined) {
      return false;
    }
    return hourly >= minHourlyRate;
  }

  if (upperBound === undefined && lowerBound === undefined) {
    return false;
  }

  const effectiveUpper = upperBound ?? lowerBound ?? 0;
  const effectiveLower = lowerBound ?? effectiveUpper;
  return effectiveUpper >= minBudget && effectiveLower <= maxBudget;
}

function validateCandidate(candidate: NormalizedFreelancerCandidate, criteria: FreelanceSearchCriteria): { ok: true } | { ok: false; reason: string } {
  if (!isFreelancerDomain(candidate.url)) {
    return { ok: false, reason: "hostname is not freelancer.com" };
  }
  if (!isProjectUrl(candidate.url)) {
    return { ok: false, reason: "URL is not a Freelancer project listing" };
  }
  if (!candidate.title || !candidate.description) {
    return { ok: false, reason: "project page did not contain a real title and description" };
  }
  if (!isLikelyFreelancerProjectTitle(candidate.title, criteria)) {
    return { ok: false, reason: "title does not look like a real project title" };
  }
  if (!candidate.skills.length && !candidate.budgetDetails && !candidate.bidCount) {
    return { ok: false, reason: "project page did not contain enough project-specific data" };
  }
  return { ok: true };
}

export async function searchFreelancerLeads(
  criteria: FreelanceSearchCriteria,
  options: FreelancerSearchOptions = {},
): Promise<FreelancerSearchResult> {
  const fetchHtml = options.fetchHtml ?? (async (url: string) => {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Legwork/1.0 (+https://github.com/hellojakesmith/Legwork)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`Freelancer request failed for ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  });

  const discoveryUrls = options.discoveryUrls ?? buildFreelancerDiscoveryUrls(criteria, options.maxDiscoveryUrls ?? 4);
  const metrics: FreelancerSearchMetrics = {
    provider: "freelancer",
    discoveryUrls,
    pagesVisited: 0,
    projectsDiscovered: 0,
    projectsExtracted: 0,
    projectsValidated: 0,
    duplicatesRemoved: 0,
    budgetFiltered: 0,
    finalLeadCount: 0,
  };

  const seenKeys = new Set<string>();
  const candidates: NormalizedFreelancerCandidate[] = [];
  const parseErrors: string[] = [];

  for (const discoveryUrl of discoveryUrls) {
    metrics.pagesVisited += 1;
    const searchHtml = await fetchHtml(discoveryUrl);
    const cards = extractSearchCards(searchHtml, discoveryUrl);
    metrics.projectsDiscovered += cards.length;

    if (cards.length === 0) {
      parseErrors.push(`No project cards found on ${discoveryUrl}`);
      continue;
    }

    for (const card of cards) {
      if (!isProjectUrl(card.url)) {
        parseErrors.push(`Rejected non-project URL on ${card.url}`);
        continue;
      }

      const normalizedUrl = normalizeProjectKey(card.url);
      if (seenKeys.has(normalizedUrl)) {
        metrics.duplicatesRemoved += 1;
        continue;
      }

      metrics.pagesVisited += 1;
      const projectHtml = await fetchHtml(card.url);
      const projectPath = new URL(card.url).pathname.replace(/^\/projects\//, "").replace(/\/$/, "");
      const projectDoc = extractProjectDocument(projectHtml, projectPath);
      if (!projectDoc) {
        parseErrors.push(`Could not extract Freelancer project data from ${card.url}`);
        continue;
      }

      metrics.projectsExtracted += 1;
      const candidate = normalizeCandidate(card, discoveryUrl, projectDoc);
      if (!candidate) {
        parseErrors.push(`Could not normalize project at ${card.url}`);
        continue;
      }

      const validation = validateCandidate(candidate, criteria);
      if (!validation.ok) {
        parseErrors.push(`${candidate.url}: ${validation.reason}`);
        continue;
      }

      metrics.projectsValidated += 1;
      seenKeys.add(normalizedUrl);
      candidates.push(candidate);
    }
  }

  const filtered = candidates.filter((candidate) => {
    if (!passesBudgetFilter(candidate, criteria)) {
      metrics.budgetFiltered += 1;
      return false;
    }
    return true;
  });

  const leads = filtered
    .map((candidate) => {
      const baseLead: Omit<FreelanceLead, "technicalFitScore" | "budgetFitScore" | "clientQualityScore" | "competitionScore" | "overallScore" | "scoreLabel" | "recommendedApproach" | "reasonForRecommendation" | "status" | "kind" | "discoveredAt"> = {
        id: candidate.projectId ? `freelancer-${candidate.projectId}` : `freelancer-${normalizeProjectKey(candidate.url).replace(/[^a-z0-9]+/gi, "-")}`,
        platform: "Freelancer.com",
        title: candidate.title,
        url: candidate.url,
        description: candidate.description,
        summary: candidate.summary,
        budget: candidate.budget,
        budgetType: candidate.budgetDetails?.type,
        budgetDetails: candidate.budgetDetails,
        hourlyRate: candidate.hourlyRate,
        skills: candidate.skills,
        clientName: candidate.clientName,
        clientLocation: candidate.clientLocation,
        clientRating: candidate.clientRating,
        clientReviewCount: candidate.clientReviewCount,
        clientSpend: candidate.clientSpend,
        clientHireRate: candidate.clientHireRate,
        projectAge: candidate.projectAge,
        competitionCount: candidate.competitionCount,
        bidCount: candidate.bidCount,
        client: candidate.client,
        sourceQuery: candidate.sourceQuery,
        sourceUrl: candidate.sourceUrl,
        source: candidate.source,
      };

      return baseLead;
    })
    .map((lead) => ({
      ...lead,
      discoveredAt: nowIso(),
      status: "new" as const,
      kind: "freelance" as const,
    }));

  metrics.finalLeadCount = leads.length;

  let failureMessage: string | undefined;
  if (leads.length === 0) {
    const parseFailure = metrics.projectsDiscovered === 0 || (metrics.projectsValidated === 0 && metrics.budgetFiltered === 0);
    if (parseFailure) {
      failureMessage = `Freelancer.com could not be successfully parsed. ${metrics.pagesVisited} pages visited, 0 valid projects extracted.`;
    }
  }

  return {
    leads,
    metrics,
    ...(failureMessage ? { failureMessage } : {}),
  };
}

