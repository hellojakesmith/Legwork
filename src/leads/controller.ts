import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { planGoal } from "../core/planner.js";
import { WorkflowStore } from "../workflows/workflow-store.js";
import { PlaywrightBrowserAgent } from "../browser/playwright-browser-agent.js";
import type { BrowserActionContext, BrowserAgent, BrowserChallenge } from "../browser/browser-agent.js";
import type { LeadSearchStore } from "../storage/lead-search-store.js";
import { searchFreelancerLeads } from "./freelancer-source.js";
import type {
  BusinessLead,
  BusinessSearchCriteria,
  FreelanceLead,
  FreelanceSearchCriteria,
  Lead,
  LeadMode,
  LeadSearchEvent,
  LeadSearchRecord,
  LeadSearchRequest,
  LeadStatus,
  LeadSearchStatus,
} from "./types.js";
import { scoreBusinessLead, scoreFreelanceLead } from "./scoring.js";
import type { TaskPlan, WorkflowDefinition } from "../core/types.js";

type BrowserContextFactory = (recordId: string, stepId: string, emit: (event: LeadSearchEvent) => void) => BrowserActionContext;

interface LeadSearchControllerOptions {
  browserAgentFactory?: () => BrowserAgent;
  createPlan?: (request: Parameters<typeof planGoal>[0]) => TaskPlan | Promise<TaskPlan>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function event(type: string, message: string, data?: Record<string, unknown>): LeadSearchEvent {
  return {
    id: createId("lead_event"),
    at: nowIso(),
    type,
    message,
    ...(data ? { data } : {}),
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 240): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function labelFromScore(score: number): string {
  if (score >= 90) return "Excellent Opportunity";
  if (score >= 80) return "Strong Opportunity";
  if (score >= 65) return "Worth Considering";
  return "Low Priority";
}

function toSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePrice(text: string): string | undefined {
  const match = text.match(/(?:USD\s*)?\$[\d,]+(?:\s*(?:-|to)\s*\$?[\d,]+)?/i);
  return match ? match[0] : undefined;
}

function parseFirstMatch(text: string, regex: RegExp): string | undefined {
  return text.match(regex)?.[1]?.trim();
}

function parseNumber(text: string, regex: RegExp): number | undefined {
  const match = text.match(regex)?.[1];
  if (!match) return undefined;
  const value = Number.parseInt(match.replace(/,/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
}

function pagePreview(text: string): string {
  const parts = text.split(/\n{2,}/).map((part) => normalizeWhitespace(part)).filter(Boolean);
  return truncate(parts[0] ?? text, 260);
}

function extractSocialLinks(links: Array<{ href?: string; text?: string }>): string[] {
  return uniqueBy(
    links
      .map((link) => link.href ?? "")
      .filter((href) => /instagram|facebook|linkedin|x\.com|twitter|youtube|tiktok/i.test(href)),
    (href) => href,
  );
}

function createBrowserContext(
  recordId: string,
  stepId: string,
  emit: (event: LeadSearchEvent) => void,
): BrowserActionContext {
  return {
    runId: recordId,
    stepId,
    emit: (browserEvent) => {
      emit({
        id: browserEvent.id,
        at: browserEvent.at,
        type: browserEvent.type,
        message: browserEvent.message,
        ...(browserEvent.data ? { data: browserEvent.data } : {}),
      });
    },
  };
}

function detectChallengeMessage(error: unknown): BrowserChallenge | undefined {
  if (error && typeof error === "object" && "challenge" in error) {
    return (error as { challenge?: BrowserChallenge }).challenge;
  }
  return undefined;
}

function createFreelanceGoal(criteria: FreelanceSearchCriteria): string {
  return `Find freelance projects on Freelancer.com that match: ${criteria.objective}. Skills: ${criteria.skills.join(", ")}. Keywords: ${criteria.keywords.join(", ")}. Platforms: ${criteria.platforms.join(", ")}.`;
}

function createBusinessGoal(criteria: BusinessSearchCriteria): string {
  return `Find business leads for ${criteria.profileId} in ${criteria.location}. Business types: ${criteria.businessTypes.join(", ")}. Industries: ${criteria.industries.join(", ")}. Keywords: ${criteria.keywords.join(", ")}.`;
}

function searchQueriesFromBusiness(criteria: BusinessSearchCriteria): Array<{ source: string; query: string; sourceLabel: string }> {
  const base = [criteria.businessTypes.join(" "), criteria.industries.join(" "), criteria.keywords.join(" "), criteria.location, criteria.targetCustomer ?? ""].filter(Boolean).join(" ");
  const locationHint = criteria.radiusMiles ? `within ${criteria.radiusMiles} miles of ${criteria.location}` : criteria.location;
  return [
    {
      source: "search",
      sourceLabel: "Web search",
      query: `${base} ${locationHint}`,
    },
  ];
}

function extractFreelanceLead(
  payload: {
    pageText: string;
    title?: string;
    url: string;
    platformLabel: string;
    query: string;
    links: Array<{ href?: string; text?: string }>;
  },
  criteria: FreelanceSearchCriteria,
): Omit<FreelanceLead, "technicalFitScore" | "budgetFitScore" | "clientQualityScore" | "competitionScore" | "overallScore" | "scoreLabel" | "recommendedApproach" | "reasonForRecommendation" | "status" | "kind" | "discoveredAt"> {
  const title = normalizeWhitespace(payload.title ?? payload.pageText.split("\n")[0] ?? "Untitled project");
  const description = pagePreview(payload.pageText);
  const skills = uniqueBy([...(criteria.skills), ...(criteria.preferredTechnologies), ...(criteria.keywords)].filter(Boolean), (item) => item.toLowerCase());
  const budget = parsePrice(payload.pageText);
  const hourlyRate = parseFirstMatch(payload.pageText, /(?:hourly|per hour|\/hr|\/hour)\D*(\$\s?[\d,]+(?:\.\d{1,2})?)/i);
  const budgetType = /hourly|per hour|\/hr|\/hour/i.test(payload.pageText) ? "hourly" : budget ? "fixed" : "unknown";
  const clientName = parseFirstMatch(payload.pageText, /client[:\s]+([^\n]+)/i);
  const clientLocation = parseFirstMatch(payload.pageText, /location[:\s]+([^\n]+)/i);
  const clientRating = parseFirstMatch(payload.pageText, /(\d(?:\.\d)?\s*\/\s*5|\d(?:\.\d)?\s*stars?)/i);
  const clientReviewCount = parseNumber(payload.pageText, /(\d[\d,]*)\s*reviews?/i);
  const clientSpend = parsePrice(payload.pageText.match(/spend[\s\S]{0,40}/i)?.[0] ?? "");
  const clientHireRate = parseFirstMatch(payload.pageText, /hire rate[:\s]+([^\n]+)/i);
  const projectAge = parseFirstMatch(payload.pageText, /posted[:\s]+([^\n]+)/i) ?? parseFirstMatch(payload.pageText, /(\d+\s*(?:minutes?|hours?|days?|weeks?)\s*ago)/i);
  const competitionCount = parseNumber(payload.pageText, /(\d[\d,]*)\s*(?:bids?|proposals?)/i);
  return {
    id: createId("freelance_lead"),
    platform: payload.platformLabel,
    title,
    url: payload.url,
    description,
    summary: description,
    budget,
    budgetType,
    hourlyRate,
    skills,
    clientName,
    clientLocation,
    clientRating,
    clientReviewCount,
    clientSpend,
    clientHireRate,
    projectAge,
    competitionCount,
    sourceQuery: payload.query,
    sourceUrl: payload.url,
  };
}

function extractBusinessLead(
  payload: {
    pageText: string;
    title?: string;
    url: string;
    sourceLabel: string;
    query: string;
    links: Array<{ href?: string; text?: string }>;
  },
  criteria: BusinessSearchCriteria,
): Omit<BusinessLead, "qualificationScore" | "fitScore" | "opportunityScore" | "overallScore" | "scoreLabel" | "reasonForRecommendation" | "status" | "kind" | "discoveredAt"> {
  const title = normalizeWhitespace(payload.title ?? payload.pageText.split("\n")[0] ?? "Untitled business");
  const website = payload.url;
  const description = pagePreview(payload.pageText);
  const socialProfiles = extractSocialLinks(payload.links);
  const phone = parseFirstMatch(payload.pageText, /(?:phone|call|tel)[:\s]*([+\d(). -]{7,})/i);
  const email = parseFirstMatch(payload.pageText, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const employeeCount = parseFirstMatch(payload.pageText, /(\d[\d,]*\+?\s*(?:employees?|team members?|staff))/i);
  const services = uniqueBy(
    [
      ...criteria.businessTypes,
      ...criteria.industries,
      ...(payload.pageText.match(/(marketing|seo|web design|booking|lead generation|nutrition|coaching|fitness|wellness|automation)/gi) ?? []),
    ].map((item) => item.trim()).filter(Boolean),
    (item) => item.toLowerCase(),
  );
  return {
    id: createId("business_lead"),
    businessName: title,
    businessType: criteria.businessTypes[0] ?? criteria.profileId,
    industry: criteria.industries[0] ?? criteria.profileId,
    website,
    url: payload.url,
    location: criteria.location,
    phone,
    email,
    socialProfiles,
    description,
    services,
    employeeCount,
    source: payload.sourceLabel,
    sourceQuery: payload.query,
    potentialNeed: "",
    recommendedOffer: "",
  };
}

function sortAndTrimFreelance(results: FreelanceLead[], criteria: FreelanceSearchCriteria): FreelanceLead[] {
  const target = Math.max(1, criteria.maxLeads);
  return uniqueBy(results, (lead) => lead.url || lead.title.toLowerCase())
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, target);
}

function sortAndTrimBusiness(results: BusinessLead[], criteria: BusinessSearchCriteria): BusinessLead[] {
  const target = Math.max(1, criteria.maxLeads);
  return uniqueBy(results, (lead) => lead.website || lead.businessName.toLowerCase())
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, target);
}

export class LeadSearchController {
  constructor(
    private readonly store: LeadSearchStore,
    private readonly workflowStore: WorkflowStore,
    private readonly options: LeadSearchControllerOptions = {},
  ) {}

  list(): Promise<LeadSearchRecord[]> {
    return this.store.list();
  }

  load(id: string): Promise<LeadSearchRecord | undefined> {
    return this.store.load(id);
  }

  async updateLeadStatus(searchId: string, leadId: string, status: LeadStatus): Promise<LeadSearchRecord | undefined> {
    return this.store.updateLeadStatus(searchId, leadId, status);
  }

  async saveWorkflow(searchId: string, name?: string): Promise<{ workflow: WorkflowDefinition; mermaid: string } | undefined> {
    const record = await this.store.load(searchId);
    if (!record) {
      return undefined;
    }
    const workflow: WorkflowDefinition = {
      id: createId("workflow"),
      name: name ?? record.title,
      description: `Saved from lead search ${record.id}`,
      createdAt: nowIso(),
      sourceRunId: record.id,
      plan: record.planSnapshot,
      inputsSchema: { type: "object", properties: {} },
      outputsSchema: { type: "object", properties: {} },
    };
    await this.workflowStore.save(workflow);
    await this.store.markSaved(record.id, workflow.id);
    return { workflow, mermaid: this.workflowStore.toMermaid(workflow) };
  }

  async start(request: LeadSearchRequest, options: { browserAgent?: BrowserAgent; credentialSessionId?: string; resolveCredentials?: (credentialSessionId: string) => Promise<unknown>; onEvent?: (event: LeadSearchEvent, record?: LeadSearchRecord) => void } = {}): Promise<LeadSearchRecord> {
    const id = createId("lead_search");
    const createdAt = nowIso();
    const criteria = request.criteria;
    const title = request.mode === "freelance"
      ? "Find Freelance Work"
      : "Find Business Leads";
    const goal = request.mode === "freelance"
      ? createFreelanceGoal(criteria as FreelanceSearchCriteria)
      : createBusinessGoal(criteria as BusinessSearchCriteria);
    const plan = this.options.createPlan
      ? await this.options.createPlan({ goal, inputs: { leadSearch: request } })
      : planGoal({ goal, inputs: { leadSearch: request } });

    const record: LeadSearchRecord = {
      id,
      mode: request.mode,
      title,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      criteria,
      planSnapshot: plan,
      events: [event("lead.search.started", `Started ${title.toLowerCase()}.`)],
      results: [],
      summary: "Working...",
    };

    await this.store.save(record);
    void this.run(record, request, options).catch((error) => {
      record.status = "failed";
      record.error = error instanceof Error ? error.stack ?? error.message : String(error);
      record.updatedAt = nowIso();
      record.summary = "Lead search failed.";
      record.events.push(event("lead.search.failed", record.error));
      void this.store.save(record);
    });
    return record;
  }

  private async run(record: LeadSearchRecord, request: LeadSearchRequest, options: { browserAgent?: BrowserAgent; credentialSessionId?: string; resolveCredentials?: (credentialSessionId: string) => Promise<unknown>; onEvent?: (event: LeadSearchEvent, record?: LeadSearchRecord) => void }): Promise<void> {
    const emit = async (nextEvent: LeadSearchEvent) => {
      record.events.push(nextEvent);
      record.updatedAt = nowIso();
      options.onEvent?.(nextEvent, record);
      await this.store.save(record);
    };

    const browserAgent = options.browserAgent ?? new PlaywrightBrowserAgent(true);
    let shouldCloseBrowser = !options.browserAgent;

    const contextFactory: BrowserContextFactory = (runId, stepId, emitLead) => ({
      runId,
      stepId,
      emit: (browserEvent) => {
        emitLead({
          id: browserEvent.id,
          at: browserEvent.at,
          type: browserEvent.type,
          message: browserEvent.message,
          ...(browserEvent.data ? { data: browserEvent.data } : {}),
        });
      },
      ...(options.credentialSessionId ? { credentialSessionId: options.credentialSessionId } : {}),
      ...(options.resolveCredentials
        ? {
            resolveCredentials: async (sessionId) => {
              const credentials = await options.resolveCredentials?.(sessionId);
              return credentials as never;
            },
          }
        : {}),
    });

    try {
      await emit(event("lead.search.phase", "Understanding your criteria."));
      await delay(50);
      await emit(event("lead.search.phase", "Searching public sources."));

      if (request.mode === "freelance") {
        const result = await this.collectFreelanceLeads(record, request.criteria as FreelanceSearchCriteria, browserAgent, contextFactory, emit);
        record.results = sortAndTrimFreelance(result.leads, request.criteria as FreelanceSearchCriteria);
        record.observability = {
          provider: result.metrics.provider,
          discoveryUrls: result.metrics.discoveryUrls,
          pagesVisited: result.metrics.pagesVisited,
          projectsDiscovered: result.metrics.projectsDiscovered,
          projectsExtracted: result.metrics.projectsExtracted,
          projectsValidated: result.metrics.projectsValidated,
          duplicatesRemoved: result.metrics.duplicatesRemoved,
          budgetFiltered: result.metrics.budgetFiltered,
          finalLeadCount: result.metrics.finalLeadCount,
        };
        record.events.push(event("lead.search.metrics", "Freelancer discovery completed.", record.observability as Record<string, unknown>));
        if (result.failureMessage && record.results.length === 0) {
          record.status = "failed";
          record.completedAt = nowIso();
          record.summary = result.failureMessage;
          record.error = result.failureMessage;
          record.events.push(event("lead.search.failed", result.failureMessage, record.observability as Record<string, unknown>));
          record.updatedAt = nowIso();
          await this.store.save(record);
          return;
        }
      } else {
        const results = await this.collectBusinessLeads(record, request.criteria as BusinessSearchCriteria, browserAgent, contextFactory, emit);
        record.results = sortAndTrimBusiness(results, request.criteria as BusinessSearchCriteria);
      }

      record.status = "completed";
      record.completedAt = nowIso();
      record.summary = `${record.results.length} leads found.`;
      record.events.push(event("lead.search.completed", record.summary, { totalLeads: record.results.length }));
      record.updatedAt = nowIso();
      await this.store.save(record);
    } catch (error) {
      const challenge = detectChallengeMessage(error);
      if (challenge) {
        record.status = "waiting_for_approval";
        record.summary = challenge.message;
        record.events.push(event("lead.search.blocked", challenge.message, { challengeType: challenge.type }));
        await this.store.save(record);
        return;
      }
      throw error;
    } finally {
      if (shouldCloseBrowser) {
        await browserAgent.close().catch(() => undefined);
      }
    }
  }

  private async collectFreelanceLeads(
    record: LeadSearchRecord,
    criteria: FreelanceSearchCriteria,
    emit: (event: LeadSearchEvent) => Promise<void>,
    browserAgent: BrowserAgent,
    contextFactory: BrowserContextFactory,
  ): Promise<{ leads: FreelanceLead[]; metrics: { provider: "freelancer"; discoveryUrls: string[]; pagesVisited: number; projectsDiscovered: number; projectsExtracted: number; projectsValidated: number; duplicatesRemoved: number; budgetFiltered: number; finalLeadCount: number }; failureMessage?: string }> {
    void browserAgent;
    void contextFactory;
    await emit(event("lead.search.source.started", "Searching Freelancer.com directly.", { source: "freelancer" }));
    const result = await searchFreelancerLeads(criteria, { maxDiscoveryUrls: 4 });
    for (const discoveryUrl of result.metrics.discoveryUrls) {
      await emit(event("lead.search.source.completed", `Visited Freelancer discovery page ${discoveryUrl}.`, { source: "freelancer", discoveryUrl }));
    }
    if (result.leads.length > 0) {
      for (const lead of result.leads) {
        await emit(event("lead.search.result", `Collected ${lead.title}`, { score: lead.overallScore, url: lead.url }));
      }
    }
    return result;
  }

  private async collectBusinessLeads(
    record: LeadSearchRecord,
    criteria: BusinessSearchCriteria,
    browserAgent: BrowserAgent,
    contextFactory: BrowserContextFactory,
    emit: (event: LeadSearchEvent) => Promise<void>,
  ): Promise<BusinessLead[]> {
    const searches = searchQueriesFromBusiness(criteria);
    const collected: BusinessLead[] = [];
    const seenWebsites = new Set<string>();

    for (const search of searches) {
      await emit(event("lead.search.source.started", `Searching ${search.sourceLabel}.`, { source: search.source }));
      const searchContext = contextFactory(record.id, createId("lead_step"), (nextEvent) => {
        void emit(nextEvent);
      });
      await browserAgent.open(toSearchUrl(search.query), searchContext);
      const structured = (await browserAgent.extractStructured({ selector: "body" }, searchContext)) as { title?: string; text?: string; links?: Array<{ href?: string; text?: string }> };
      const links = uniqueBy(
        (structured.links ?? [])
          .map((link) => ({ href: link.href ?? "", text: link.text ?? "" }))
          .filter((link) => /^https?:\/\//i.test(link.href) && !/duckduckgo\.com/i.test(link.href)),
        (item) => item.href,
      );

      for (const link of links.slice(0, Math.max(4, criteria.maxLeads * 2))) {
        if (!link.href || seenWebsites.has(link.href)) {
          continue;
        }
        seenWebsites.add(link.href);
        const pageContext = contextFactory(record.id, createId("lead_step"), (nextEvent) => {
          void emit(nextEvent);
        });
        await browserAgent.open(link.href, pageContext).catch(() => undefined);
        const pageStructured = (await browserAgent.extractStructured({ selector: "body" }, pageContext).catch(() => undefined)) as
          | { title?: string; text?: string; links?: Array<{ href?: string; text?: string }> }
          | undefined;
        const pageText = await browserAgent.extractText({ selector: "body" }, pageContext).catch(() => "");
        const raw = extractBusinessLead(
          {
            pageText: pageText || pageStructured?.text || "",
            title: pageStructured?.title ?? link.text,
            url: link.href,
            sourceLabel: search.sourceLabel,
            query: search.query,
            links: pageStructured?.links ?? [],
          },
          criteria,
        );
        const scored = scoreBusinessLead(raw, criteria);
        collected.push(scored);
        await emit(event("lead.search.result", `Collected ${scored.businessName}`, { score: scored.overallScore, url: scored.website }));
      }

      await emit(event("lead.search.source.completed", `Completed search on ${search.sourceLabel}.`, { source: search.source, collected: collected.length }));
    }

    return collected;
  }
}
