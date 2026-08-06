import { useEffect, useMemo, useState } from "react";
import { LeadWorkspace } from "./LeadWorkspace.js";

type PlanStep = {
  id: string;
  title: string;
  details: string;
  kind: string;
  requiresApproval?: boolean;
  approvalReason?: string;
  browserAction?: { type: string; url?: string; selector?: string; text?: string };
};

type TaskPlan = {
  id: string;
  goal: string;
  summary: string;
  createdAt: string;
  steps: PlanStep[];
};

type RunRecord = {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  checkpoint: { stepIndex: number; awaitingApprovalForStepId?: string };
  outputs: Array<{ label: string; value: unknown }>;
  events: Array<{ id: string; at: string; type: string; message: string; stepId?: string; data?: Record<string, unknown> }>;
  planSnapshot: TaskPlan;
  error?: string;
};

type CredentialSession = {
  id: string;
  label?: string;
  createdAt: string;
  expiresAt: string;
};

type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceRunId: string;
};

type InternalAgent = {
  id: string;
  title: string;
  mission: string;
  permissions: string[];
  outputs: string[];
};

type ImprovementSummary = {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  waitingForApprovalRuns: number;
  averageRetries: number;
  topFailureMessages: Array<{ message: string; count: number }>;
  browserErrorCount: number;
  browserChallengeCount: number;
};

type ImprovementProposal = {
  id: string;
  title: string;
  problem: string;
  expectedImpact: string;
  targetAgent: string;
};

type ChatKind = "intro" | "goal" | "note" | "warning" | "error" | "result";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: ChatKind;
  title: string;
  body: string;
  createdAt: string;
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

function safeParseJson(value: string): Record<string, unknown> {
  try {
    return value.trim() ? (JSON.parse(value) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function artifactUrl(pathValue: unknown): string | null {
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    return null;
  }
  return `/artifacts/${pathValue.replace(/^\/+/, "")}`;
}

function latestArtifact(outputs: Array<{ label: string; value: unknown }>, predicate: (output: { label: string; value: unknown }) => boolean) {
  return [...outputs].reverse().find(predicate);
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function summarizeCurrentStep(run?: RunRecord): string {
  if (!run) return "No active run.";
  const latestStarted = [...run.events].reverse().find((event) => event.type === "run.step.started");
  if (latestStarted) {
    return latestStarted.message.replace(/^Starting step \d+: /, "");
  }
  if (run.status === "waiting_for_approval") {
    return "Waiting for approval";
  }
  if (run.status === "completed") {
    return "Finished";
  }
  if (run.status === "failed") {
    return "Failed";
  }
  return "Running";
}

function progressPercent(run?: RunRecord, plan?: TaskPlan | null): number {
  if (!run || !plan || plan.steps.length === 0) {
    return 0;
  }
  return Math.min(100, Math.round((run.checkpoint.stepIndex / plan.steps.length) * 100));
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function makeMessage(kind: ChatKind, role: ChatMessage["role"], title: string, body: string): ChatMessage {
  return {
    id: `${kind}-${crypto.randomUUID()}`,
    role,
    kind,
    title,
    body,
    createdAt: new Date().toISOString(),
  };
}

function eventToMessage(event: { type: string; message: string }, run?: RunRecord): ChatMessage | null {
  switch (event.type) {
    case "run.approval.required":
      return makeMessage("warning", "assistant", "Approval needed", event.message);
    case "browser.challenge":
      return makeMessage("warning", "assistant", "Browser challenge", event.message);
    case "run.failed":
      return makeMessage("error", "assistant", "Run failed", run?.error ?? event.message);
    case "run.completed":
      return makeMessage("result", "assistant", "Run finished", "The work is complete. Results and artifacts are available below.");
    default:
      return null;
  }
}

function planSummary(plan: TaskPlan): string {
  const approvals = plan.steps.filter((step) => step.requiresApproval).length;
  const browserSteps = plan.steps.filter((step) => step.kind === "browser" || step.kind === "auth").length;
  return `${plan.steps.length} steps · ${browserSteps} browser actions · ${approvals} approval gates`;
}

function runSummary(run: RunRecord): string {
  const outputs = run.outputs.length;
  return `Status: ${run.status}. Steps completed: ${Math.min(run.checkpoint.stepIndex, run.planSnapshot.steps.length)} / ${run.planSnapshot.steps.length}. Outputs collected: ${outputs}.`;
}

function GeneralVAView() {
  const [goal, setGoal] = useState("Compare business insurance providers, gather quotes, and save the results to a spreadsheet.");
  const [contextSummary, setContextSummary] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [preferencesJson, setPreferencesJson] = useState("{\n  \n}");
  const [constraints, setConstraints] = useState("Do not submit anything without approval.\nUse only my own accounts.");
  const [accountHints, setAccountHints] = useState("Google Workspace login\nLinkedIn account");
  const [credentialLabel, setCredentialLabel] = useState("Work portal");
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialOtp, setCredentialOtp] = useState("");
  const [credentialNotes, setCredentialNotes] = useState("");
  const [credentialSessionId, setCredentialSessionId] = useState("");
  const [credentialSessions, setCredentialSessions] = useState<CredentialSession[]>([]);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [agents, setAgents] = useState<InternalAgent[]>([]);
  const [improvementSummary, setImprovementSummary] = useState<ImprovementSummary | null>(null);
  const [improvementProposals, setImprovementProposals] = useState<ImprovementProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  async function refresh() {
    const [runData, workflowData, credentialData, agentData] = await Promise.all([
      api<RunRecord[]>("/api/runs"),
      api<WorkflowDefinition[]>("/api/workflows"),
      api<CredentialSession[]>("/api/credential-sessions"),
      api<InternalAgent[]>("/api/agents"),
    ]);
    setRuns(runData);
    setWorkflows(workflowData);
    setCredentialSessions(credentialData);
    setAgents(agentData);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  const latestRun = useMemo(() => runs[0], [runs]);
  const activeRun = useMemo(() => {
    if (activeRunId) {
      return runs.find((run) => run.id === activeRunId) ?? null;
    }
    return latestRun ?? null;
  }, [activeRunId, latestRun, runs]);

  useEffect(() => {
    if (!activeRun || isTerminal(activeRun.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      refresh().catch((err) => setError(err.message));
    }, 1400);

    return () => window.clearInterval(interval);
  }, [activeRun, activeRunId]);

  async function getOrCreatePlan(): Promise<TaskPlan> {
    const nextPlan = await api<TaskPlan>("/api/plan", {
      method: "POST",
      body: JSON.stringify({
        goal,
        context: buildContextPayload(),
      }),
    });
    setPlan(nextPlan);
    return nextPlan;
  }

  async function handlePlan() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await getOrCreatePlan();
      setNotice("Plan ready. Review the task list, then run it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextPlan = await getOrCreatePlan();
      const started = await api<RunRecord>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          goal,
          context: buildContextPayload(),
          plan: nextPlan,
          ...(credentialSessionId ? { credentialSessionId } : {}),
        }),
      });
      setActiveRunId(started.id);
      setNotice("Run started. Live progress is updating below.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkflow(runId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/runs/${runId}/workflow`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      setNotice("Workflow saved from the completed run.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndResume(runId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const resumed = await api<RunRecord>(`/api/runs/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({
          ...(credentialSessionId ? { credentialSessionId } : {}),
        }),
      });
      setActiveRunId(resumed.id);
      setNotice("Approval recorded. Execution resumed in the background.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createCredentialSession() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await api<CredentialSession & { id: string }>("/api/credential-sessions", {
        method: "POST",
        body: JSON.stringify({
          label: credentialLabel || undefined,
          credentials: {
            username: credentialUsername || undefined,
            password: credentialPassword || undefined,
            otp: credentialOtp || undefined,
            notes: credentialNotes || undefined,
          },
        }),
      });
      setCredentialSessionId(session.id);
      setNotice(`Created runtime credential session ${session.id}. It only exists in memory.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function analyzeImprovement() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ summary: ImprovementSummary; proposals: ImprovementProposal[] }>("/api/improvement/analyze", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setImprovementSummary(result.summary);
      setImprovementProposals(result.proposals);
      setNotice(`Generated ${result.proposals.length} improvement proposal(s) from run history.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function buildContextPayload() {
    const preferences = safeParseJson(preferencesJson);
    return {
      summary: contextSummary || undefined,
      resumeText: resumeText || undefined,
      preferences: Object.keys(preferences).length ? preferences : undefined,
      constraints: splitLines(constraints),
      accountHints: splitLines(accountHints),
      credentialSessionId: credentialSessionId || undefined,
    };
  }

  const activePlan = plan ?? activeRun?.planSnapshot ?? null;
  const activeStepIndex = activeRun ? Math.min(activeRun.checkpoint.stepIndex + 1, activePlan?.steps.length ?? activeRun.checkpoint.stepIndex + 1) : 0;
  const currentTask = summarizeCurrentStep(activeRun ?? undefined);
  const executionPercent = progressPercent(activeRun ?? undefined, activePlan);
  const outputs = activeRun?.outputs ?? [];
  const recentEvents = activeRun?.events.slice(-8) ?? [];
  const screenshotArtifact = latestArtifact(
    outputs,
    (output) => typeof output.value === "object" && output.value !== null && "path" in (output.value as object) && output.label.toLowerCase().includes("screenshot"),
  );
  const summaryArtifact = latestArtifact(outputs, (output) => output.label === "Run summary");
  const summaryArtifactUrl = summaryArtifact ? artifactUrl((summaryArtifact.value as { markdownPath?: unknown } | undefined)?.markdownPath) : null;

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Legwork personal VA</p>
          <h1>Give it a goal. It plans, works, pauses only when needed, and brings back results.</h1>
          <p className="lede">
            The main flow is intentionally simple: describe the goal, review the task list, run it, watch live progress, and save the result as a reusable workflow.
          </p>
          <div className="hero-points">
            <span>Browser automation</span>
            <span>Runtime credentials</span>
            <span>Approval gates</span>
            <span>Reusable workflows</span>
          </div>
        </div>

        <div className="composer">
          <label className="field field-goal">
            <span className="field-label">Goal</span>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={7} placeholder="Describe the work you want done." />
          </label>
          <div className="composer-actions">
            <button onClick={handleRun} disabled={busy} className="primary-button">
              {busy ? "Working..." : "Run plan"}
            </button>
            <button onClick={handlePlan} disabled={busy} className="secondary-button">
              {busy ? "Working..." : "Review plan"}
            </button>
          </div>
          <p className="composer-hint">Plan first if you want a preview, or run immediately to start execution.</p>
          {notice ? <div className="notice">{notice}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <section className="primary-grid">
        <article className="panel panel-plan">
          <div className="panel-header">
            <div>
              <h2>Planned tasks</h2>
              <p className="muted">
                {activePlan ? activePlan.summary : "Generate a plan to see the ordered, executable task list."}
              </p>
            </div>
            <span className="panel-badge">{activePlan ? `${activePlan.steps.length} steps` : "No plan yet"}</span>
          </div>

          {activePlan ? (
            <ol className="task-list">
              {activePlan.steps.map((step, index) => (
                <li key={step.id} className="task-card">
                  <div className="task-number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="task-body">
                    <div className="task-topline">
                      <strong>{step.title}</strong>
                      <span className={`pill ${step.kind}`}>{step.kind}</span>
                    </div>
                    <p>{step.details}</p>
                    <div className="task-meta">
                      {step.browserAction ? <span>Action: {step.browserAction.type}</span> : <span>Action: analysis</span>}
                      {step.requiresApproval ? <span className="approval-chip">approval required</span> : <span>auto-runs</span>}
                    </div>
                    {step.approvalReason ? <p className="approval-reason">{step.approvalReason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <strong>No plan yet.</strong>
              <p>Add a goal above, then choose Review plan to inspect the task list before running it.</p>
            </div>
          )}
        </article>

        <article className="panel panel-run">
          <div className="panel-header">
            <div>
              <h2>Live execution</h2>
              <p className="muted">Watch the current task, progress, and live event stream.</p>
            </div>
            <span className={`panel-badge status ${activeRun?.status ?? "idle"}`}>{activeRun?.status ?? "idle"}</span>
          </div>

          {activeRun ? (
            <>
              <div className="status-box">
              <div>
                  <div className="status-title">{currentTask}</div>
                  <div className="status-subtitle">
                    Step {activeStepIndex} of {activePlan?.steps.length ?? activeRun.checkpoint.stepIndex + 1}
                  </div>
                </div>
                <div className="status-progress">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${executionPercent}%` }} />
                  </div>
                  <span>{executionPercent}%</span>
                </div>
              </div>

              {activeRun.checkpoint.awaitingApprovalForStepId ? (
                <div className="approval-callout">
                  <strong>Approval needed</strong>
                  <p>Run is paused on step {activeRun.checkpoint.awaitingApprovalForStepId}.</p>
                  <button className="secondary-button" onClick={() => approveAndResume(activeRun.id)} disabled={busy}>
                    Approve and resume
                  </button>
                </div>
              ) : null}

              <div className="event-stream">
                {recentEvents.length > 0 ? (
                  recentEvents.map((event) => (
                    <div key={event.id} className="event-row">
                      <span className="event-time">{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      <div>
                        <strong>{event.type}</strong>
                        <p>{event.message}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <strong>No activity yet.</strong>
                    <p>Start a run and this panel will stream step updates and browser events.</p>
                  </div>
                )}
              </div>

              {screenshotArtifact ? (
                <div className="live-artifact">
                  <strong>Latest screenshot</strong>
                  {artifactUrl((screenshotArtifact.value as { path?: unknown }).path) ? (
                    <img
                      className="artifact-image"
                      src={artifactUrl((screenshotArtifact.value as { path?: unknown }).path) ?? undefined}
                      alt={screenshotArtifact.label}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <strong>No active run.</strong>
              <p>Run a plan to see live progress here.</p>
            </div>
          )}
        </article>
      </section>

      <section className="primary-grid secondary-grid">
        <article className="panel panel-results">
          <div className="panel-header">
            <div>
              <h2>Results</h2>
              <p className="muted">{activeRun?.status === "completed" ? "A finished run summary and its artifacts appear here." : "When a run completes, this panel turns into the final result view."}</p>
            </div>
            {activeRun?.status === "completed" ? (
              <button className="secondary-button" onClick={() => saveWorkflow(activeRun.id)} disabled={busy}>
                Save workflow
              </button>
            ) : null}
          </div>

          {activeRun?.status === "completed" ? (
            <div className="result-grid">
              <div className="result-summary">
                <strong>Completed goal</strong>
                <p>{activeRun.goal}</p>
                <p className="muted">Finished at {activeRun.updatedAt}</p>
                {summaryArtifact ? (
                  <div className="summary-block">
                    <strong>Final summary</strong>
                    {summaryArtifactUrl ? (
                      <a href={summaryArtifactUrl} target="_blank" rel="noreferrer">
                        Open summary artifact
                      </a>
                    ) : null}
                    <pre>{JSON.stringify(summaryArtifact.value, null, 2)}</pre>
                  </div>
                ) : null}
              </div>

              <div className="result-artifacts">
                <strong>Artifacts</strong>
                {outputs.length > 0 ? (
                  outputs.map((output, index) => {
                    const path = output.value && typeof output.value === "object" ? artifactUrl((output.value as { path?: unknown }).path) : null;
                    return (
                      <div key={`${output.label}-${index}`} className="artifact-card">
                        <div className="artifact-head">
                          <strong>{output.label}</strong>
                          {path ? <a href={path} target="_blank" rel="noreferrer">Open</a> : null}
                        </div>
                        <pre>{JSON.stringify(output.value, null, 2)}</pre>
                        {path ? <img src={path} alt={output.label} className="artifact-image" /> : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state compact">
                    <strong>No artifacts yet.</strong>
                    <p>When browser steps collect screenshots or extracted data, they appear here.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Awaiting completion.</strong>
              <p>The final result view appears once the run finishes.</p>
            </div>
          )}
        </article>

        <article className="panel panel-summary">
          <div className="panel-header">
            <div>
              <h2>Run history</h2>
              <p className="muted">Recent runs, status changes, and any failures.</p>
            </div>
            <span className="panel-badge">{runs.length} total</span>
          </div>
          <div className="history-list">
            {runs.length > 0 ? (
              runs.slice(0, 6).map((run) => (
                <button key={run.id} className="history-row" onClick={() => setActiveRunId(run.id)}>
                  <div>
                    <strong>{run.goal}</strong>
                    <p>{new Date(run.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`pill ${run.status}`}>{run.status}</span>
                </button>
              ))
            ) : (
              <div className="empty-state compact">
                <strong>No runs yet.</strong>
                <p>Your first run will appear here.</p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="secondary-section">
        <details className="detail-card">
          <summary>Runtime credentials</summary>
          <div className="detail-grid">
            <div className="detail-copy">
              <p className="muted">Create an in-memory credential session for authenticated browser work. Nothing is written to disk.</p>
            </div>
            <div className="detail-form">
              <label className="field">
                <span className="field-label">Session label</span>
                <input value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} placeholder="Work portal" />
              </label>
              <label className="field">
                <span className="field-label">Username or email</span>
                <input value={credentialUsername} onChange={(event) => setCredentialUsername(event.target.value)} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} type="password" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">One-time code</span>
                <input value={credentialOtp} onChange={(event) => setCredentialOtp(event.target.value)} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Notes</span>
                <textarea value={credentialNotes} onChange={(event) => setCredentialNotes(event.target.value)} rows={3} />
              </label>
              <button className="secondary-button" onClick={createCredentialSession} disabled={busy}>
                Create runtime session
              </button>
              <div className="session-list">
                {credentialSessions.map((session) => (
                  <div key={session.id} className="session-row">
                    <div>
                      <strong>{session.label || session.id}</strong>
                      <p>{session.expiresAt}</p>
                    </div>
                    <span className="pill running">active</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

        <details className="detail-card">
          <summary>Context and preferences</summary>
          <div className="detail-grid">
            <div className="detail-copy">
              <p className="muted">Use this area for resume text, profile links, constraints, and preference hints. It feeds the planner but stays out of the main flow.</p>
            </div>
            <div className="detail-form">
              <label className="field">
                <span className="field-label">Context summary</span>
                <textarea value={contextSummary} onChange={(event) => setContextSummary(event.target.value)} rows={2} />
              </label>
              <label className="field">
                <span className="field-label">Resume text</span>
                <textarea value={resumeText} onChange={(event) => setResumeText(event.target.value)} rows={4} />
              </label>
              <label className="field">
                <span className="field-label">Preferences JSON</span>
                <textarea value={preferencesJson} onChange={(event) => setPreferencesJson(event.target.value)} rows={4} />
              </label>
              <label className="field">
                <span className="field-label">Constraints</span>
                <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={3} />
              </label>
              <label className="field">
                <span className="field-label">Account hints</span>
                <textarea value={accountHints} onChange={(event) => setAccountHints(event.target.value)} rows={2} />
              </label>
            </div>
          </div>
        </details>

        <details className="detail-card">
          <summary>Workflows and self-improvement</summary>
          <div className="detail-grid">
            <div className="detail-copy">
              <p className="muted">Successful runs can be saved as reusable workflows. The self-improvement layer observes history and generates proposals, but it never merges to main.</p>
              <div className="actions-inline">
                <button className="secondary-button" onClick={analyzeImprovement} disabled={busy}>
                  Analyze history
                </button>
              </div>
              {improvementSummary ? <pre>{JSON.stringify(improvementSummary, null, 2)}</pre> : null}
            </div>
            <div className="detail-form">
              <div className="mini-list">
                {workflows.length > 0 ? (
                  workflows.map((workflow) => (
                    <div key={workflow.id} className="mini-row">
                      <div>
                        <strong>{workflow.name}</strong>
                        <p>{workflow.description}</p>
                      </div>
                      <span className="pill workflow">saved</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <strong>No workflows yet.</strong>
                    <p>Save a successful run to reuse it later.</p>
                  </div>
                )}
              </div>
              <div className="mini-list">
                {agents.map((agent) => (
                  <div key={agent.id} className="mini-row">
                    <div>
                      <strong>{agent.title}</strong>
                      <p>{agent.mission}</p>
                    </div>
                    <span className="pill running">{agent.id}</span>
                  </div>
                ))}
              </div>
              <div className="mini-list">
                {improvementProposals.map((proposal) => (
                  <div key={proposal.id} className="mini-row">
                    <div>
                      <strong>{proposal.title}</strong>
                      <p>{proposal.problem}</p>
                    </div>
                    <span className="pill">{proposal.targetAgent}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

type AppMode = "general" | "freelance" | "business" | "workflows" | "settings";

export function App() {
  const [mode, setMode] = useState<AppMode>("general");

  return (
    <div className="mode-shell">
      <aside className="mode-nav">
        <div className="mode-brand">
          <div className="mode-mark">L</div>
          <div>
            <strong>Legwork</strong>
            <p>Personal VA</p>
          </div>
        </div>
        <nav className="mode-tabs" aria-label="Primary">
          <button className={`mode-tab ${mode === "general" ? "active" : ""}`} onClick={() => setMode("general")}>
            General VA
          </button>
          <button className={`mode-tab ${mode === "freelance" ? "active" : ""}`} onClick={() => setMode("freelance")}>
            Freelance Leads
          </button>
          <button className={`mode-tab ${mode === "business" ? "active" : ""}`} onClick={() => setMode("business")}>
            Business Leads
          </button>
          <button className={`mode-tab ${mode === "workflows" ? "active" : ""}`} onClick={() => setMode("workflows")}>
            Workflows
          </button>
          <button className={`mode-tab ${mode === "settings" ? "active" : ""}`} onClick={() => setMode("settings")}>
            Settings
          </button>
        </nav>
        <div className="mode-footer">
          <div className="mode-user-mark">J</div>
          <div>
            <strong>Jake Smith</strong>
            <p>Pro Plan</p>
          </div>
        </div>
      </aside>

      <main className="mode-panel">
        {mode === "general" ? <GeneralVAView /> : <LeadWorkspace mode={mode} onBack={setMode} />}
      </main>
    </div>
  );
}
