import { useEffect, useMemo, useState } from "react";

type LeadMode = "freelance" | "business" | "workflows" | "settings";

type LeadStatus = "new" | "saved" | "dismissed" | "contacted" | "qualified" | "converted" | "won" | "lost" | "not_interested";

type FreelanceSearchCriteria = {
  objective: string;
  keywords: string[];
  skills: string[];
  platforms: Array<"freelancer" | "upwork" | "search">;
  minBudget?: number | undefined;
  maxBudget?: number | undefined;
  budgetType: "fixed_price" | "hourly" | "both";
  minHourlyRate?: number | undefined;
  preferredTechnologies: string[];
  projectTypes: string[];
  locationRequirements?: string | undefined;
  remotePreference: "remote" | "hybrid" | "onsite" | "any";
  additionalInstructions?: string | undefined;
  maxLeads: number;
};

type BusinessSearchCriteria = {
  profileId: "getsparkd" | "nutra_vida";
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
};

type FreelanceLead = {
  kind: "freelance";
  id: string;
  platform: string;
  title: string;
  url: string;
  description?: string;
  summary: string;
  budget?: string;
  budgetType?: "fixed" | "hourly" | "unknown";
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
  technicalFitScore: number;
  budgetFitScore: number;
  clientQualityScore: number;
  competitionScore: number;
  overallScore: number;
  scoreLabel: string;
  recommendedBid?: string;
  recommendedApproach: string;
  reasonForRecommendation: string;
  discoveredAt: string;
  status: LeadStatus;
  sourceQuery: string;
  sourceUrl?: string;
};

type BusinessLead = {
  kind: "business";
  id: string;
  businessName: string;
  businessType: string;
  industry: string;
  website?: string;
  url?: string;
  location?: string;
  phone?: string;
  email?: string;
  socialProfiles: string[];
  description?: string;
  services: string[];
  employeeCount?: string;
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
};

type Lead = FreelanceLead | BusinessLead;

type LeadSearchRecord = {
  id: string;
  mode: "freelance" | "business";
  title: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  criteria: FreelanceSearchCriteria | BusinessSearchCriteria;
  planSnapshot: { steps: Array<{ id: string; title: string; details: string; kind: string }>; summary: string; createdAt: string };
  events: Array<{ id: string; at: string; type: string; message: string; data?: Record<string, unknown> }>;
  results: Lead[];
  summary: string;
  error?: string;
  savedWorkflowId?: string;
};

type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceRunId: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

function splitTags(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTags(value: string[]): string {
  return value.join(", ");
}

function scoreSummary(score: number): string {
  if (score >= 90) return `${score} — Excellent`;
  if (score >= 80) return `${score} — Strong`;
  if (score >= 65) return `${score} — Consider`;
  return `${score} — Low Priority`;
}

function blankFreelanceCriteria(): FreelanceSearchCriteria {
  return {
    objective: "Find Node.js, TypeScript, React, AI automation, API integration, and SaaS projects with budgets above $500.",
    keywords: ["Node.js", "TypeScript", "React", "AI automation", "API integrations", "SaaS"],
    skills: ["Node.js", "TypeScript", "React", "AI automation"],
    platforms: ["freelancer"],
    minBudget: 500,
    maxBudget: 5000,
    budgetType: "both",
    minHourlyRate: 0,
    preferredTechnologies: ["Node.js", "TypeScript", "React"],
    projectTypes: ["Web Apps", "Automation", "Integrations"],
    locationRequirements: "",
    remotePreference: "remote",
    additionalInstructions: "Prioritize projects with budgets above $500 and clients that appear likely to hire.",
    maxLeads: 20,
  };
}

function blankBusinessCriteria(profileId: "getsparkd" | "nutra_vida"): BusinessSearchCriteria {
  return profileId === "getsparkd"
    ? {
        profileId,
        location: "Austin, TX",
        radiusMiles: 25,
        businessTypes: ["Gyms", "Fitness Studios", "Personal Trainers", "Fitness Coaches", "Wellness Businesses"],
        industries: ["Fitness", "Wellness"],
        keywords: ["weak website", "local SEO", "lead generation", "paid ads", "social media"],
        targetCustomer: "Business owners needing marketing help",
        companySize: "Small to medium",
        websiteRequired: true,
        socialPresenceRequired: false,
        additionalCriteria: "Prioritize local businesses that appear to have weak websites or weak local SEO.",
        maxLeads: 30,
      }
    : {
        profileId,
        location: "Austin, TX",
        radiusMiles: 50,
        businessTypes: ["Fitness Coaches", "Nutrition Coaches", "Wellness Creators", "Gyms"],
        industries: ["Nutrition", "Fitness", "Wellness"],
        keywords: ["partnership", "distribution", "affiliate", "customer", "creator"],
        targetCustomer: "Potential customers or partners for Nutra Vida",
        companySize: "Any",
        websiteRequired: false,
        socialPresenceRequired: true,
        additionalCriteria: "Find businesses and creators that could benefit from AI nutrition tracking.",
        maxLeads: 30,
      };
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function latestSearchForMode(searches: LeadSearchRecord[], mode: LeadMode): LeadSearchRecord | null {
  return searches.find((search) => search.mode === mode) ?? null;
}

export function LeadWorkspace({ mode, onBack }: { mode: LeadMode; onBack: (mode: LeadMode) => void }) {
  const [freelanceCriteria, setFreelanceCriteria] = useState(blankFreelanceCriteria());
  const [businessCriteria, setBusinessCriteria] = useState<BusinessSearchCriteria>(blankBusinessCriteria("getsparkd"));
  const [searches, setSearches] = useState<LeadSearchRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);

  async function refresh() {
    const [searchData, workflowData] = await Promise.all([
      api<LeadSearchRecord[]>("/api/lead-searches"),
      api<WorkflowDefinition[]>("/api/workflows"),
    ]);
    setSearches(searchData);
    setWorkflows(workflowData);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  const activeSearch = useMemo(() => {
    const selected = searches.find((search) => search.id === selectedSearchId);
    if (selected) return selected;
    return latestSearchForMode(searches, mode);
  }, [mode, searches, selectedSearchId]);

  useEffect(() => {
    if (!activeSearch || ["completed", "failed", "canceled"].includes(activeSearch.status)) {
      return;
    }
    const interval = window.setInterval(() => {
      refresh().catch((err) => setError(err.message));
    }, 1300);
    return () => window.clearInterval(interval);
  }, [activeSearch?.id, activeSearch?.status]);

  useEffect(() => {
    setSelectedLeadId(null);
    setProposalOpen(false);
  }, [mode, activeSearch?.id]);

  const activePlan = activeSearch?.planSnapshot ?? null;
  const activeResults = activeSearch?.results ?? [];
  const filteredResults = activeResults;
  const selectedLead = filteredResults.find((lead) => lead.id === selectedLeadId) ?? filteredResults[0] ?? null;
  const reviewedCount = activeSearch ? activeSearch.events.filter((event) => event.type === "lead.search.result").length : 0;
  const sourceCount = activeSearch ? activeSearch.events.filter((event) => event.type === "lead.search.source.completed").length : 0;
  const highPriorityCount = activeResults.filter((lead) => lead.overallScore >= 80).length;
  const qualifiedCount = activeResults.filter((lead) => lead.status !== "dismissed").length;
  const totalLabel = `${filteredResults.length} leads`;

  async function startFreelanceSearch(criteria = freelanceCriteria) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api<LeadSearchRecord>("/api/lead-searches", {
        method: "POST",
        body: JSON.stringify({ mode: "freelance", criteria }),
      });
      setSelectedSearchId(created.id);
      setNotice("Freelance search started.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startBusinessSearch(criteria = businessCriteria) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api<LeadSearchRecord>("/api/lead-searches", {
        method: "POST",
        body: JSON.stringify({ mode: "business", criteria }),
      });
      setSelectedSearchId(created.id);
      setNotice("Business search started.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateLeadStatus(leadId: string, status: LeadStatus) {
    if (!activeSearch) return;
    setBusy(true);
    try {
      await api(`/api/lead-searches/${activeSearch.id}/leads/${leadId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await refresh();
      setNotice(`Marked lead as ${status.replace(/_/g, " ")}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSearchWorkflow() {
    if (!activeSearch) return;
    setBusy(true);
    try {
      await api(`/api/lead-searches/${activeSearch.id}/workflow`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refresh();
      setNotice("Saved as workflow.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rerunSearch() {
    if (!activeSearch) return;
    if (activeSearch.mode === "freelance") {
      await startFreelanceSearch(activeSearch.criteria as FreelanceSearchCriteria);
    } else {
      await startBusinessSearch(activeSearch.criteria as BusinessSearchCriteria);
    }
  }

  function renderSidebar() {
    return (
      <aside className="lead-sidebar">
        <div className="panel lead-sidebar-panel">
          <div className="panel-header">
            <div>
              <h2>Saved searches</h2>
              <p className="muted">Reusable workflows and recent lead searches.</p>
            </div>
          </div>
          <div className="mini-list">
            {searches.length > 0 ? (
              searches.slice(0, 8).map((search) => (
                <button key={search.id} className="history-row" onClick={() => setSelectedSearchId(search.id)}>
                  <div>
                    <strong>{search.title}</strong>
                    <p>{new Date(search.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`pill ${search.status}`}>{search.status}</span>
                </button>
              ))
            ) : (
              <div className="empty-state compact">
                <strong>No searches yet.</strong>
                <p>Run a search and save it as a workflow.</p>
              </div>
            )}
          </div>
          <div className="mini-list">
            {workflows.length > 0 ? (
              workflows.slice(0, 8).map((workflow) => (
                <div key={workflow.id} className="mini-row">
                  <div>
                    <strong>{workflow.name}</strong>
                    <p>{workflow.description}</p>
                  </div>
                  <span className="pill workflow">saved</span>
                </div>
              ))
            ) : null}
          </div>
        </div>
      </aside>
    );
  }

  function renderFreelanceMode() {
    return (
      <section className="lead-mode-grid">
        <main className="lead-main">
          <article className="panel lead-hero">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Freelance Leads</p>
                <h1>Find Freelance Work</h1>
                <p className="muted">Let Legwork find projects that match your skills, budget, and experience.</p>
              </div>
              <span className="panel-badge">{totalLabel}</span>
            </div>

            <label className="field field-goal">
              <span className="field-label">What kind of freelance work are you looking for?</span>
              <textarea value={freelanceCriteria.objective} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, objective: event.target.value })} rows={4} />
            </label>

            <div className="lead-filter-grid">
              <div>
                <span className="field-label">Platforms</span>
                <div className="chip-row">
                  {(["freelancer", "upwork"] as const).map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      className={`chip ${freelanceCriteria.platforms.includes(platform) ? "active" : ""}`}
                      onClick={() =>
                        setFreelanceCriteria({
                          ...freelanceCriteria,
                          platforms: freelanceCriteria.platforms.includes(platform)
                            ? freelanceCriteria.platforms.filter((item) => item !== platform)
                            : [...freelanceCriteria.platforms, platform],
                        })
                      }
                    >
                      {platform === "freelancer" ? "Freelancer.com" : "Upwork"}
                    </button>
                  ))}
                  <span className="chip disabled">More coming soon</span>
                </div>
              </div>

              <label className="field">
                <span className="field-label">Skills</span>
                <input value={joinTags(freelanceCriteria.skills)} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, skills: splitTags(event.target.value) })} placeholder="Node.js, TypeScript, React" />
              </label>
              <label className="field">
                <span className="field-label">Keywords</span>
                <input value={joinTags(freelanceCriteria.keywords)} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, keywords: splitTags(event.target.value) })} placeholder="AI automation, API integration" />
              </label>
              <label className="field">
                <span className="field-label">Preferred technologies</span>
                <input value={joinTags(freelanceCriteria.preferredTechnologies)} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, preferredTechnologies: splitTags(event.target.value) })} placeholder="Node.js, TypeScript, React" />
              </label>
              <div className="lead-inline-fields">
                <label className="field">
                  <span className="field-label">Minimum budget</span>
                  <input type="number" value={freelanceCriteria.minBudget ?? ""} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, minBudget: Number(event.target.value) || undefined })} />
                </label>
                <label className="field">
                  <span className="field-label">Maximum budget</span>
                  <input type="number" value={freelanceCriteria.maxBudget ?? ""} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, maxBudget: Number(event.target.value) || undefined })} />
                </label>
                <label className="field">
                  <span className="field-label">Minimum hourly rate</span>
                  <input type="number" value={freelanceCriteria.minHourlyRate ?? ""} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, minHourlyRate: Number(event.target.value) || undefined })} />
                </label>
                <label className="field">
                  <span className="field-label">Maximum leads</span>
                  <input type="number" value={freelanceCriteria.maxLeads} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, maxLeads: Number(event.target.value) || 20 })} />
                </label>
              </div>
            </div>

            <details className="detail-card compact-card">
              <summary>Advanced filters</summary>
              <div className="detail-stack">
                <label className="field">
                  <span className="field-label">Project types</span>
                  <input value={joinTags(freelanceCriteria.projectTypes)} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, projectTypes: splitTags(event.target.value) })} placeholder="Web Apps, SaaS, Automation" />
                </label>
                <label className="field">
                  <span className="field-label">Location requirements</span>
                  <input value={freelanceCriteria.locationRequirements ?? ""} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, locationRequirements: event.target.value })} placeholder="Remote preferred" />
                </label>
                <label className="field">
                  <span className="field-label">Remote preference</span>
                  <select value={freelanceCriteria.remotePreference} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, remotePreference: event.target.value as FreelanceSearchCriteria["remotePreference"] })}>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">Onsite</option>
                    <option value="any">Any</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Additional instructions</span>
                  <textarea value={freelanceCriteria.additionalInstructions ?? ""} onChange={(event) => setFreelanceCriteria({ ...freelanceCriteria, additionalInstructions: event.target.value })} rows={3} />
                </label>
              </div>
            </details>

            <div className="composer-actions">
              <button className="primary-button" onClick={() => void startFreelanceSearch()} disabled={busy}>
                Find Leads
              </button>
              <button className="secondary-button" onClick={() => void rerunSearch()} disabled={busy || !activeSearch}>
                Run again
              </button>
              <button className="ghost-button" onClick={() => void saveSearchWorkflow()} disabled={busy || !activeSearch}>
                Save search as workflow
              </button>
            </div>
            {notice ? <div className="notice">{notice}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Legwork is finding opportunities</h2>
                <p className="muted">Live execution updates appear here without browser logs.</p>
              </div>
              <span className={`panel-badge status ${activeSearch?.status ?? "idle"}`}>{activeSearch?.status ?? "idle"}</span>
            </div>
            {activeSearch ? (
              <div className="lead-progress-card">
                <div className="lead-progress-stats">
                  <span>{reviewedCount} projects reviewed</span>
                  <span>{qualifiedCount} qualified</span>
                  <span>{highPriorityCount} high-priority opportunities</span>
                </div>
                {activePlan ? (
                  <ol className="lead-plan">
                    {activePlan.steps.map((step, index) => (
                      <li key={step.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{step.title}</strong>
                          <p>{step.details}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <div className="event-stream">
                  {activeSearch.events.slice(-6).map((event) => (
                    <div key={event.id} className="event-row">
                      <span className="event-time">{formatTime(event.at)}</span>
                      <div>
                        <strong>{event.type}</strong>
                        <p>{event.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No active search.</strong>
                <p>Run a search and the live progress state will appear here.</p>
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Results</h2>
                <p className="muted">Ranked by technical fit, budget, client quality, and likelihood of winning.</p>
              </div>
              <span className="panel-badge">{filteredResults.length} found</span>
            </div>

            <div className="lead-results-list">
              {filteredResults.length > 0 ? (
                filteredResults.map((lead) => (
                  <button key={lead.id} className={`lead-result-row ${selectedLeadId === lead.id ? "selected" : ""}`} onClick={() => setSelectedLeadId(lead.id)}>
                    <div className="lead-result-main">
                      <div className="lead-result-topline">
                        <strong>{lead.kind === "freelance" ? lead.title : lead.businessName}</strong>
                        <span className="pill">{lead.kind}</span>
                      </div>
                      <p>{lead.kind === "freelance" ? lead.summary : lead.description}</p>
                      <div className="lead-tags">
                        {lead.kind === "freelance" ? lead.skills.slice(0, 4).map((skill) => <span key={skill} className="pill">{skill}</span>) : lead.services.slice(0, 4).map((service) => <span key={service} className="pill">{service}</span>)}
                      </div>
                    </div>
                    <div className="lead-result-side">
                      <strong>{lead.scoreLabel}</strong>
                      <span>{lead.kind === "freelance" ? lead.platform : lead.source}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state compact">
                  <strong>No leads yet.</strong>
                  <p>Legwork will populate this list once search completes.</p>
                </div>
              )}
            </div>
          </article>
        </main>

        <aside className="lead-drawer">
          {selectedLead ? (
            <article className="panel drawer-panel">
              <div className="panel-header">
                <div>
                  <h2>{selectedLead.kind === "freelance" ? selectedLead.title : selectedLead.businessName}</h2>
                  <p className="muted">{selectedLead.kind === "freelance" ? selectedLead.platform : selectedLead.source}</p>
                </div>
                <span className="panel-badge">{scoreSummary(selectedLead.overallScore)}</span>
              </div>

              {selectedLead.kind === "freelance" ? (
                <>
                  <div className="drawer-section">
                    <strong>Project</strong>
                    <p>{selectedLead.description}</p>
                    <p className="muted">{selectedLead.budget ?? selectedLead.hourlyRate ?? "Budget unavailable"}</p>
                    <a href={selectedLead.url} target="_blank" rel="noreferrer">Open Project</a>
                  </div>
                  <div className="drawer-section">
                    <strong>Client</strong>
                    <p>{selectedLead.clientName ?? "Client details unavailable"}</p>
                    <p className="muted">{selectedLead.clientRating ?? "No rating"} · {selectedLead.clientReviewCount ?? 0} reviews · {selectedLead.clientHireRate ?? "hire rate unavailable"}</p>
                  </div>
                  <div className="drawer-section">
                    <strong>Legwork analysis</strong>
                    <p>{selectedLead.reasonForRecommendation}</p>
                    <p className="muted">Recommended bid: {selectedLead.recommendedBid ?? "Estimate manually"}</p>
                    <p className="muted">Recommended approach: {selectedLead.recommendedApproach}</p>
                  </div>
                  <div className="drawer-section">
                    <strong>Create Proposal</strong>
                    <p>Legwork can create a personalized proposal based on this project and your profile.</p>
                    <button className="secondary-button" onClick={() => setProposalOpen(true)}>
                      Generate Proposal
                    </button>
                    {proposalOpen ? <div className="notice">Proposal generation can be added here later.</div> : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="drawer-section">
                    <strong>Business</strong>
                    <p>{selectedLead.description}</p>
                    <p className="muted">{selectedLead.location ?? "Location unavailable"} · {selectedLead.website ?? selectedLead.url ?? "No website"}</p>
                    {selectedLead.phone ? <p className="muted">Phone: {selectedLead.phone}</p> : null}
                    {selectedLead.email ? <p className="muted">Email: {selectedLead.email}</p> : null}
                    {selectedLead.website ? <a href={selectedLead.website} target="_blank" rel="noreferrer">Open Website</a> : null}
                  </div>
                  <div className="drawer-section">
                    <strong>Potential need</strong>
                    <p>{selectedLead.potentialNeed}</p>
                    <p className="muted">Recommended offer: {selectedLead.recommendedOffer}</p>
                  </div>
                  <div className="drawer-section">
                    <strong>Why this is a good lead</strong>
                    <p>{selectedLead.reasonForRecommendation}</p>
                  </div>
                </>
              )}

              <div className="drawer-actions">
                {selectedLead.kind === "freelance" ? (
                  <button className="primary-button" onClick={() => void updateLeadStatus(selectedLead.id, "saved")}>
                    Save Lead
                  </button>
                ) : (
                  <button className="primary-button" onClick={() => void updateLeadStatus(selectedLead.id, "qualified")}>
                    Mark Qualified
                  </button>
                )}
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "contacted")}>
                  Mark Contacted
                </button>
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "dismissed")}>
                  Dismiss
                </button>
                <button className="ghost-button" onClick={() => void updateLeadStatus(selectedLead.id, selectedLead.kind === "freelance" ? "won" : "converted")}>
                  Mark {selectedLead.kind === "freelance" ? "Won" : "Converted"}
                </button>
              </div>
            </article>
          ) : (
            <div className="panel drawer-panel">
              <div className="empty-state">
                <strong>Select a lead.</strong>
                <p>The detail drawer opens here when you click a result.</p>
              </div>
            </div>
          )}
        </aside>
      </section>
    );
  }

  function renderBusinessMode() {
    const selectedProfile = businessCriteria.profileId;
    const activeCopy = selectedProfile === "getsparkd"
      ? {
          title: "Find Business Leads",
          subtitle: "Tell Legwork who you want to reach. We'll research businesses and identify the strongest opportunities.",
        }
      : {
          title: "Find Business Leads",
          subtitle: "Tell Legwork who you want to reach. We'll research businesses and identify the strongest opportunities.",
        };

    return (
      <section className="lead-mode-grid">
        <main className="lead-main">
          <article className="panel lead-hero">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Business Leads</p>
                <h1>{activeCopy.title}</h1>
                <p className="muted">{activeCopy.subtitle}</p>
              </div>
              <span className="panel-badge">{totalLabel}</span>
            </div>

            <div className="profile-grid">
              <button type="button" className={`profile-card ${businessCriteria.profileId === "getsparkd" ? "active" : ""}`} onClick={() => setBusinessCriteria(blankBusinessCriteria("getsparkd"))}>
                <strong>GetSparkd</strong>
                <p>Fitness coaching & marketing</p>
              </button>
              <button type="button" className={`profile-card ${businessCriteria.profileId === "nutra_vida" ? "active" : ""}`} onClick={() => setBusinessCriteria(blankBusinessCriteria("nutra_vida"))}>
                <strong>Nutra Vida</strong>
                <p>AI nutrition & macro tracking</p>
              </button>
            </div>

            <div className="lead-filter-grid">
              <label className="field">
                <span className="field-label">Location</span>
                <input value={businessCriteria.location} onChange={(event) => setBusinessCriteria({ ...businessCriteria, location: event.target.value })} />
              </label>
              <div className="lead-inline-fields">
                <label className="field">
                  <span className="field-label">Radius</span>
                  <input type="number" value={businessCriteria.radiusMiles ?? ""} onChange={(event) => setBusinessCriteria({ ...businessCriteria, radiusMiles: Number(event.target.value) || undefined })} />
                </label>
                <label className="field">
                  <span className="field-label">Maximum leads</span>
                  <input type="number" value={businessCriteria.maxLeads} onChange={(event) => setBusinessCriteria({ ...businessCriteria, maxLeads: Number(event.target.value) || 30 })} />
                </label>
              </div>
              <label className="field">
                <span className="field-label">Business types</span>
                <input value={joinTags(businessCriteria.businessTypes)} onChange={(event) => setBusinessCriteria({ ...businessCriteria, businessTypes: splitTags(event.target.value) })} />
              </label>
              <label className="field">
                <span className="field-label">Industry / category</span>
                <input value={joinTags(businessCriteria.industries)} onChange={(event) => setBusinessCriteria({ ...businessCriteria, industries: splitTags(event.target.value) })} />
              </label>
              <label className="field">
                <span className="field-label">Keywords</span>
                <input value={joinTags(businessCriteria.keywords)} onChange={(event) => setBusinessCriteria({ ...businessCriteria, keywords: splitTags(event.target.value) })} />
              </label>
              <label className="field">
                <span className="field-label">Target customer</span>
                <input value={businessCriteria.targetCustomer ?? ""} onChange={(event) => setBusinessCriteria({ ...businessCriteria, targetCustomer: event.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Company size</span>
                <input value={businessCriteria.companySize ?? ""} onChange={(event) => setBusinessCriteria({ ...businessCriteria, companySize: event.target.value })} />
              </label>
            </div>

            <details className="detail-card compact-card">
              <summary>Qualification criteria</summary>
              <div className="detail-stack">
                <label className="field">
                  <span className="field-label">Website required</span>
                  <select value={String(Boolean(businessCriteria.websiteRequired))} onChange={(event) => setBusinessCriteria({ ...businessCriteria, websiteRequired: event.target.value === "true" })}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Social presence required</span>
                  <select value={String(Boolean(businessCriteria.socialPresenceRequired))} onChange={(event) => setBusinessCriteria({ ...businessCriteria, socialPresenceRequired: event.target.value === "true" })}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Additional criteria</span>
                  <textarea value={businessCriteria.additionalCriteria ?? ""} onChange={(event) => setBusinessCriteria({ ...businessCriteria, additionalCriteria: event.target.value })} rows={3} />
                </label>
              </div>
            </details>

            <div className="composer-actions">
              <button className="primary-button" onClick={() => void startBusinessSearch()} disabled={busy}>
                Find Leads
              </button>
              <button className="secondary-button" onClick={() => void rerunSearch()} disabled={busy || !activeSearch}>
                Run again
              </button>
              <button className="ghost-button" onClick={() => void saveSearchWorkflow()} disabled={busy || !activeSearch}>
                Save search as workflow
              </button>
            </div>
            {notice ? <div className="notice">{notice}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Legwork is finding opportunities</h2>
                <p className="muted">Business research updates appear here without technical noise.</p>
              </div>
              <span className={`panel-badge status ${activeSearch?.status ?? "idle"}`}>{activeSearch?.status ?? "idle"}</span>
            </div>
            {activeSearch ? (
              <div className="lead-progress-card">
                <div className="lead-progress-stats">
                  <span>{reviewedCount} businesses reviewed</span>
                  <span>{qualifiedCount} qualified</span>
                  <span>{highPriorityCount} high-priority opportunities</span>
                </div>
                {activePlan ? (
                  <ol className="lead-plan">
                    {activePlan.steps.map((step, index) => (
                      <li key={step.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{step.title}</strong>
                          <p>{step.details}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <div className="event-stream">
                  {activeSearch.events.slice(-6).map((event) => (
                    <div key={event.id} className="event-row">
                      <span className="event-time">{formatTime(event.at)}</span>
                      <div>
                        <strong>{event.type}</strong>
                        <p>{event.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No active search.</strong>
                <p>Run a business search and the live progress state will appear here.</p>
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Results</h2>
                <p className="muted">Ranked by fit, opportunity, and likelihood of response.</p>
              </div>
              <span className="panel-badge">{filteredResults.length} found</span>
            </div>
            <div className="lead-results-list">
              {filteredResults.length > 0 ? (
                filteredResults.map((lead) => (
                  <button key={lead.id} className={`lead-result-row ${selectedLeadId === lead.id ? "selected" : ""}`} onClick={() => setSelectedLeadId(lead.id)}>
                    <div className="lead-result-main">
                      <div className="lead-result-topline">
                        <strong>{lead.kind === "business" ? lead.businessName : lead.title}</strong>
                        <span className="pill">{lead.kind}</span>
                      </div>
                      <p>{lead.kind === "business" ? lead.description : lead.summary}</p>
                      <div className="lead-tags">
                        {lead.kind === "business" ? lead.services.slice(0, 4).map((service) => <span key={service} className="pill">{service}</span>) : lead.skills.slice(0, 4).map((skill) => <span key={skill} className="pill">{skill}</span>)}
                      </div>
                    </div>
                    <div className="lead-result-side">
                      <strong>{lead.scoreLabel}</strong>
                      <span>{lead.kind === "business" ? lead.source : lead.platform}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state compact">
                  <strong>No leads yet.</strong>
                  <p>Legwork will populate this list once search completes.</p>
                </div>
              )}
            </div>
          </article>
        </main>

        <aside className="lead-drawer">
          {selectedLead && selectedLead.kind === "business" ? (
            <article className="panel drawer-panel">
              <div className="panel-header">
                <div>
                  <h2>{selectedLead.businessName}</h2>
                  <p className="muted">{selectedLead.businessType} · {selectedLead.location}</p>
                </div>
                <span className="panel-badge">{scoreSummary(selectedLead.overallScore)}</span>
              </div>
              <div className="drawer-section">
                <strong>Business</strong>
                <p>{selectedLead.description}</p>
                <p className="muted">{selectedLead.website ?? selectedLead.url ?? "No website"}</p>
                {selectedLead.website ? <a href={selectedLead.website} target="_blank" rel="noreferrer">Open Website</a> : null}
                {selectedLead.phone ? <p className="muted">Phone: {selectedLead.phone}</p> : null}
                {selectedLead.email ? <p className="muted">Email: {selectedLead.email}</p> : null}
              </div>
              <div className="drawer-section">
                <strong>Potential need</strong>
                <p>{selectedLead.potentialNeed}</p>
                <p className="muted">Recommended offer: {selectedLead.recommendedOffer}</p>
              </div>
              <div className="drawer-section">
                <strong>Why this is a good lead</strong>
                <p>{selectedLead.reasonForRecommendation}</p>
              </div>
              <div className="drawer-actions">
                <button className="primary-button" onClick={() => void updateLeadStatus(selectedLead.id, "qualified")}>
                  Mark Qualified
                </button>
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "contacted")}>
                  Mark Contacted
                </button>
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "dismissed")}>
                  Not Interested
                </button>
                <button className="ghost-button" onClick={() => void updateLeadStatus(selectedLead.id, "converted")}>
                  Mark Converted
                </button>
              </div>
            </article>
          ) : selectedLead && selectedLead.kind === "freelance" ? (
            <article className="panel drawer-panel">
              <div className="panel-header">
                <div>
                  <h2>{selectedLead.title}</h2>
                  <p className="muted">{selectedLead.platform} · {selectedLead.budget ?? selectedLead.hourlyRate ?? "Budget unavailable"}</p>
                </div>
                <span className="panel-badge">{scoreSummary(selectedLead.overallScore)}</span>
              </div>
              <div className="drawer-section">
                <strong>Project</strong>
                <p>{selectedLead.description}</p>
                <a href={selectedLead.url} target="_blank" rel="noreferrer">View Project</a>
              </div>
              <div className="drawer-section">
                <strong>Client</strong>
                <p>{selectedLead.clientName ?? "Client details unavailable"}</p>
                <p className="muted">{selectedLead.clientRating ?? "No rating"} · {selectedLead.clientReviewCount ?? 0} reviews · {selectedLead.clientHireRate ?? "hire rate unavailable"}</p>
              </div>
              <div className="drawer-section">
                <strong>Legwork analysis</strong>
                <p>{selectedLead.reasonForRecommendation}</p>
                <p className="muted">Recommended bid: {selectedLead.recommendedBid ?? "Estimate manually"}</p>
                <p className="muted">Recommended approach: {selectedLead.recommendedApproach}</p>
              </div>
              <div className="drawer-section">
                <strong>Create Proposal</strong>
                <p>Legwork can create a personalized proposal based on this project and your profile.</p>
                <button className="secondary-button" onClick={() => setProposalOpen(true)}>
                  Generate Proposal
                </button>
                {proposalOpen ? <div className="notice">Proposal generation can be added here later.</div> : null}
              </div>
              <div className="drawer-actions">
                <button className="primary-button" onClick={() => void updateLeadStatus(selectedLead.id, "saved")}>
                  Save Lead
                </button>
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "contacted")}>
                  Mark Contacted
                </button>
                <button className="secondary-button" onClick={() => void updateLeadStatus(selectedLead.id, "dismissed")}>
                  Dismiss
                </button>
                <button className="ghost-button" onClick={() => void updateLeadStatus(selectedLead.id, "won")}>
                  Mark Won
                </button>
              </div>
            </article>
          ) : (
            <div className="panel drawer-panel">
              <div className="empty-state">
                <strong>Select a lead.</strong>
                <p>The detail drawer opens here when you click a result.</p>
              </div>
            </div>
          )}
        </aside>
      </section>
    );
  }

  function renderWorkflowsMode() {
    return (
      <section className="lead-mode-grid">
        <main className="lead-main">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Workflows</p>
                <h1>Saved Searches</h1>
                <p className="muted">Reusable workflows for lead generation runs.</p>
              </div>
            </div>
            <div className="history-list">
              {searches.length > 0 ? searches.map((search) => (
                <div key={search.id} className="history-row">
                  <div>
                    <strong>{search.title}</strong>
                    <p>{search.summary}</p>
                  </div>
                  <div className="workspace-actions">
                    <button className="secondary-button" onClick={() => setSelectedSearchId(search.id)}>
                      Open
                    </button>
                    <button className="primary-button" onClick={() => void api(`/api/lead-searches/${search.id}/workflow`, { method: "POST", body: JSON.stringify({}) }).then(refresh)}>
                      Save workflow
                    </button>
                  </div>
                </div>
              )) : (
                <div className="empty-state">
                  <strong>No saved searches yet.</strong>
                  <p>Run a lead search, then save it as a workflow to reuse later.</p>
                </div>
              )}
            </div>
          </article>
        </main>
        {renderSidebar()}
      </section>
    );
  }

  function renderSettingsMode() {
    return (
      <section className="lead-mode-grid">
        <main className="lead-main">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h1>Runtime Controls</h1>
                <p className="muted">Credentials, preferences, and self-improvement internals remain in the existing General VA mode.</p>
              </div>
            </div>
            <div className="empty-state">
              <strong>Switch to General VA for advanced controls.</strong>
              <p>The general chat mode still contains credentials, workflows, and self-improvement internals. This view stays focused on lead generation.</p>
            </div>
          </article>
        </main>
        {renderSidebar()}
      </section>
    );
  }

  return (
    <div className="lead-shell">
      {mode === "freelance" ? renderFreelanceMode() : mode === "business" ? renderBusinessMode() : mode === "workflows" ? renderWorkflowsMode() : renderSettingsMode()}
    </div>
  );
}
