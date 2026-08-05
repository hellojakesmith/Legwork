import { useEffect, useMemo, useRef, useState } from "react";

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

export function App() {
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      kind: "intro",
      title: "Legwork is ready",
      body: "Tell me what you want done. I will turn it into a plan, ask for approval only when needed, and execute it with the browser.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<"plan" | "run">("plan");
  const seenEventIds = useRef(new Set<string>());
  const announcedPlanIds = useRef(new Set<string>());
  const announcedRunStatus = useRef<Record<string, string>>({});

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
    }, 1200);

    return () => window.clearInterval(interval);
  }, [activeRun, activeRunId]);

  useEffect(() => {
    if (plan && plan.goal !== goal) {
      setPlan(null);
      setComposerMode("plan");
    }
  }, [goal, plan]);

  const activePlan = plan && plan.goal === goal ? plan : null;
  const displayedPlan = activePlan ?? (activeRun && activeRun.goal === goal ? activeRun.planSnapshot : null);
  const outputs = activeRun?.outputs ?? [];
  const recentEvents = activeRun?.events.slice(-6) ?? [];
  const screenshotArtifact = latestArtifact(
    outputs,
    (output) => typeof output.value === "object" && output.value !== null && "path" in (output.value as object) && output.label.toLowerCase().includes("screenshot"),
  );
  const summaryArtifact = latestArtifact(outputs, (output) => output.label === "Run summary");
  const summaryArtifactUrl = summaryArtifact ? artifactUrl((summaryArtifact.value as { markdownPath?: unknown } | undefined)?.markdownPath) : null;
  const activeStatus = activeRun?.status ?? "idle";

  useEffect(() => {
    if (!displayedPlan || announcedPlanIds.current.has(displayedPlan.id)) {
      return;
    }

    announcedPlanIds.current.add(displayedPlan.id);
    setMessages((current) => [
      ...current,
      makeMessage(
        "note",
        "assistant",
        "Plan ready",
        `I turned that into ${displayedPlan.steps.length} executable steps. Review the plan card below, then approve and run.`,
      ),
    ]);
  }, [displayedPlan?.id]);

  useEffect(() => {
    if (!activeRun) {
      return;
    }

    const previousStatus = announcedRunStatus.current[activeRun.id];
    if (previousStatus === activeRun.status) {
      return;
    }

    announcedRunStatus.current[activeRun.id] = activeRun.status;
    if (activeRun.status === "running") {
      setMessages((current) => [...current, makeMessage("note", "assistant", "Taking control", "I’m executing the plan now and will only stop if I’m blocked or need approval.")]);
    }
    if (activeRun.status === "waiting_for_approval") {
      setMessages((current) => [
        ...current,
        makeMessage(
          "warning",
          "assistant",
          "Waiting for approval",
          "I hit a high-risk or blocked step and paused for your approval. You can continue from the live card.",
        ),
      ]);
    }
    if (activeRun.status === "completed") {
      setMessages((current) => [
        ...current,
        makeMessage("result", "assistant", "Work complete", "The run finished. I’ve added the summary and artifacts below."),
      ]);
    }
    if (activeRun.status === "failed") {
      setMessages((current) => [
        ...current,
        makeMessage("error", "assistant", "Run failed", activeRun.error ?? "I hit an error while executing the plan."),
      ]);
    }
  }, [activeRun?.id, activeRun?.status, activeRun?.error]);

  useEffect(() => {
    if (!activeRun) {
      return;
    }

    const unseen = activeRun.events.filter((event) => !seenEventIds.current.has(event.id));
    if (unseen.length === 0) {
      return;
    }

    for (const event of unseen) {
      seenEventIds.current.add(event.id);
    }

    const notable = unseen
      .map((event) => eventToMessage(event, activeRun))
      .filter((item): item is ChatMessage => item !== null);

    if (notable.length > 0) {
      setMessages((current) => [...current, ...notable]);
    }
  }, [activeRun?.id, activeRun?.events.length]);

  async function buildContextPayload() {
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

  async function createPlanFromCurrentGoal(announceGoal = true): Promise<TaskPlan> {
    if (announceGoal) {
      setMessages((current) => [
        ...current,
        {
          id: `user-${crypto.randomUUID()}`,
          role: "user",
          kind: "goal",
          title: "New goal",
          body: goal.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    const nextPlan = await api<TaskPlan>("/api/plan", {
      method: "POST",
      body: JSON.stringify({
        goal,
        context: await buildContextPayload(),
      }),
    });
    setPlan(nextPlan);
    setComposerMode("run");
    return nextPlan;
  }

  async function handlePlan() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createPlanFromCurrentGoal(true);
      setNotice("Plan ready. Approve it from the chat or refine the goal and regenerate.");
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
      const nextPlan = plan && plan.goal === goal ? plan : await createPlanFromCurrentGoal(true);
      setMessages((current) => [
        ...current,
        makeMessage("note", "assistant", "Approve & Run", "I’m starting the autonomous run now. Live progress will appear in this thread."),
      ]);
      const started = await api<RunRecord>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          goal,
          context: await buildContextPayload(),
          plan: nextPlan,
          ...(credentialSessionId ? { credentialSessionId } : {}),
        }),
      });
      setActiveRunId(started.id);
      setNotice("Run started. Watch the conversation for live progress.");
      await refresh();
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
      setNotice("Approval recorded. Execution resumed.");
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

  const conversationMessages = useMemo(() => messages, [messages]);

  return (
    <div className="app-shell chat-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Legwork personal VA</p>
          <h1>Talk to your agent like ChatGPT, then let it work.</h1>
        </div>
        <div className={`presence ${activeStatus}`}>
          <span className="presence-dot" />
          <span>{activeStatus.replace(/_/g, " ")}</span>
        </div>
      </header>

      <div className="chat-layout">
        <main className="chat-main">
          <div className="conversation" aria-live="polite">
            {conversationMessages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role} ${message.kind}`}>
                <div className="chat-meta">
                  <span>{message.role === "user" ? "You" : "Legwork"}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                <h2>{message.title}</h2>
                <p>{message.body}</p>
              </article>
            ))}

            {displayedPlan ? (
              <article className="chat-message assistant plan">
                <div className="chat-meta">
                  <span>Legwork</span>
                  <span>{displayedPlan.steps.length} steps</span>
                </div>
                <h2>Plan ready</h2>
                <p>{displayedPlan.summary}</p>
                <div className="plan-stats">
                  <span>{planSummary(displayedPlan)}</span>
                  <span>{new Date(displayedPlan.createdAt).toLocaleString()}</span>
                </div>
                <ol className="plan-list">
                  {displayedPlan.steps.map((step, index) => (
                    <li key={step.id} className="plan-step">
                      <div className="plan-step-index">{String(index + 1).padStart(2, "0")}</div>
                      <div className="plan-step-body">
                        <div className="plan-step-topline">
                          <strong>{step.title}</strong>
                          <span className={`pill ${step.kind}`}>{step.kind}</span>
                        </div>
                        <p>{step.details}</p>
                        <div className="plan-step-meta">
                          <span>{step.browserAction ? `Action: ${step.browserAction.type}` : "Action: analysis"}</span>
                          {step.requiresApproval ? <span className="approval-chip">approval required</span> : <span>auto-runs</span>}
                        </div>
                        {step.approvalReason ? <p className="approval-reason">{step.approvalReason}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="message-actions">
                  <button onClick={handleRun} disabled={busy} className="primary-button">
                    Approve &amp; Run
                  </button>
                  <button onClick={handlePlan} disabled={busy} className="secondary-button">
                    Regenerate plan
                  </button>
                </div>
              </article>
            ) : (
              <article className="chat-message assistant intro-card">
                <div className="chat-meta">
                  <span>Legwork</span>
                  <span>Ready</span>
                </div>
                <h2>Describe the work in plain language</h2>
                <p>
                  I’ll create a concrete plan, pause only for real blockers or high-risk actions, and then execute the task with the browser and other tools.
                </p>
              </article>
            )}

            {activeRun ? (
              <article className="chat-message assistant live-card">
                <div className="chat-meta">
                  <span>Legwork live</span>
                  <span className={`pill ${activeRun.status}`}>{activeRun.status}</span>
                </div>
                <h2>{summarizeCurrentStep(activeRun)}</h2>
                <p>{runSummary(activeRun)}</p>
                <div className="progress-shell">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progressPercent(activeRun, activePlan)}%` }} />
                  </div>
                  <span>{progressPercent(activeRun, activePlan)}%</span>
                </div>
                {activeRun.checkpoint.awaitingApprovalForStepId ? (
                  <div className="approval-callout inline">
                    <strong>Approval needed</strong>
                    <p>Run is paused on step {activeRun.checkpoint.awaitingApprovalForStepId}.</p>
                    <button className="secondary-button" onClick={() => approveAndResume(activeRun.id)} disabled={busy}>
                      Approve &amp; resume
                    </button>
                  </div>
                ) : null}
                <div className="event-stream compact">
                  {recentEvents.length > 0 ? (
                    recentEvents.map((event) => (
                      <div key={event.id} className="event-row">
                        <span className="event-time">{formatTime(event.at)}</span>
                        <div>
                          <strong>{event.type}</strong>
                          <p>{event.message}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state compact">
                      <strong>No live events yet.</strong>
                      <p>The agent will stream progress here as soon as execution begins.</p>
                    </div>
                  )}
                </div>
                {screenshotArtifact ? (
                  <div className="artifact-preview">
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
              </article>
            ) : null}

            {activeRun?.status === "completed" ? (
              <article className="chat-message assistant result-card">
                <div className="chat-meta">
                  <span>Legwork</span>
                  <span>Complete</span>
                </div>
                <h2>Results are ready</h2>
                <p>{runSummary(activeRun)}</p>
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
                <div className="result-actions">
                  <button className="secondary-button" onClick={() => saveWorkflow(activeRun.id)} disabled={busy}>
                    Save workflow
                  </button>
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
                            {path ? (
                              <a href={path} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            ) : null}
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
              </article>
            ) : null}

            {messages.length === 1 && !activePlan && !activeRun ? (
              <div className="empty-thread">
                <strong>No conversation yet.</strong>
                <p>Type a goal below to start a new autonomous task.</p>
              </div>
            ) : null}
          </div>

          <div className="composer">
            <label className="field field-goal">
              <span className="field-label">Your request</span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={5}
                placeholder="For example: compare business insurance quotes, log into my account, and put the results in a spreadsheet."
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (composerMode === "run") {
                      void handleRun();
                    } else {
                      void handlePlan();
                    }
                  }
                }}
              />
            </label>
            <div className="composer-actions">
              <button
                onClick={() => void handlePlan()}
                disabled={busy || !goal.trim()}
                className="secondary-button"
              >
                Generate plan
              </button>
              <button
                onClick={() => void handleRun()}
                disabled={busy || !goal.trim()}
                className="primary-button"
              >
                Approve &amp; run
              </button>
              <button
                onClick={() => setComposerMode((mode) => (mode === "plan" ? "run" : "plan"))}
                className="ghost-button"
                type="button"
              >
                Composer: {composerMode === "plan" ? "plan" : "run"}
              </button>
            </div>
            <p className="composer-hint">
              Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to submit. I will only stop for approval, blocked pages, or genuinely high-risk actions.
            </p>
            {notice ? <div className="notice">{notice}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </div>
        </main>

        <aside className="sidebar">
          <section className="panel sidebar-panel">
            <div className="panel-header">
              <div>
                <h2>Run context</h2>
                <p className="muted">Credentials, inputs, and approvals stay secondary to the conversation.</p>
              </div>
            </div>
            <details open className="detail-card compact-card">
              <summary>Runtime credentials</summary>
              <div className="detail-stack">
                <p className="muted">Create an in-memory credential session for authenticated browser work. Nothing is written to disk.</p>
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
                <button className="secondary-button" onClick={() => void createCredentialSession()} disabled={busy}>
                  Create runtime session
                </button>
                <div className="mini-list">
                  {credentialSessions.length > 0 ? (
                    credentialSessions.map((session) => (
                      <div key={session.id} className="mini-row">
                        <div>
                          <strong>{session.label || session.id}</strong>
                          <p>{session.expiresAt}</p>
                        </div>
                        <span className="pill running">active</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state compact">
                      <strong>No runtime session yet.</strong>
                      <p>Create one when a goal needs a login.</p>
                    </div>
                  )}
                </div>
              </div>
            </details>

            <details className="detail-card compact-card">
              <summary>Context and preferences</summary>
              <div className="detail-stack">
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
            </details>

            <details className="detail-card compact-card">
              <summary>History and self-improvement</summary>
              <div className="detail-stack">
                <div className="actions-inline">
                  <button className="secondary-button" onClick={() => void analyzeImprovement()} disabled={busy}>
                    Analyze history
                  </button>
                </div>
                {improvementSummary ? <pre>{JSON.stringify(improvementSummary, null, 2)}</pre> : null}
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
            </details>

            <details className="detail-card compact-card">
              <summary>Run history</summary>
              <div className="detail-stack">
                <div className="history-list">
                  {runs.length > 0 ? (
                    runs.slice(0, 8).map((run) => (
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
              </div>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
