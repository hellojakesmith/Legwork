import { useEffect, useMemo, useState } from "react";

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
  events: Array<{ id: string; at: string; type: string; message: string; stepId?: string }>;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function handlePlan() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextPlan = await api<TaskPlan>("/api/plan", {
        method: "POST",
        body: JSON.stringify({
          goal,
          context: buildContextPayload(),
        }),
      });
      setPlan(nextPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    if (!plan) {
      await handlePlan();
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api<RunRecord>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          goal,
          context: buildContextPayload(),
          plan,
          ...(credentialSessionId ? { credentialSessionId } : {}),
        }),
      });
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
      await api(`/api/runs/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({
          ...(credentialSessionId ? { credentialSessionId } : {}),
        }),
      });
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
      setNotice(`Created runtime credential session ${session.id}. It exists only in memory on the server.`);
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
    const preferences = parseJsonOrEmpty(preferencesJson);
    return {
      summary: contextSummary || undefined,
      resumeText: resumeText || undefined,
      preferences: Object.keys(preferences).length ? preferences : undefined,
      constraints: splitLines(constraints),
      accountHints: splitLines(accountHints),
      credentialSessionId: credentialSessionId || undefined,
    };
  }

  function parseJsonOrEmpty(value: string) {
    try {
      return value.trim() ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  }

  function splitLines(value: string) {
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Legwork</p>
          <h1>Autonomous personal VA work with controlled self-improvement.</h1>
          <p className="lede">
            Plan, execute, pause for approval, and preserve every run. Successful executions can be saved as workflows and used as the basis for future improvements.
          </p>
        </div>
        <div className="hero-panel">
          <label>
            Goal
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} />
          </label>
          <label>
            Context summary
            <textarea value={contextSummary} onChange={(event) => setContextSummary(event.target.value)} rows={2} placeholder="Short description of the task and any operating assumptions" />
          </label>
          <label>
            Resume text
            <textarea value={resumeText} onChange={(event) => setResumeText(event.target.value)} rows={4} placeholder="Paste resume text or similar source material here" />
          </label>
          <label>
            Preferences JSON
            <textarea value={preferencesJson} onChange={(event) => setPreferencesJson(event.target.value)} rows={4} placeholder='{"tone":"concise"}' />
          </label>
          <label>
            Constraints
            <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={3} />
          </label>
          <label>
            Account hints
            <textarea value={accountHints} onChange={(event) => setAccountHints(event.target.value)} rows={2} />
          </label>
          <div className="actions">
            <button onClick={handlePlan} disabled={busy}>{busy ? "Working..." : "Generate plan"}</button>
            <button onClick={handleRun} className="secondary" disabled={busy}>{busy ? "Working..." : "Run plan"}</button>
          </div>
          {notice ? <div className="notice">{notice}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Runtime Credentials</h2>
          <p className="muted">
            Credentials are sent only at runtime to create an in-memory session. They are not written to disk by the app.
          </p>
          <label>
            Session label
            <input value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} placeholder="Work portal" />
          </label>
          <label>
            Username or email
            <input value={credentialUsername} onChange={(event) => setCredentialUsername(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Password
            <input value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} type="password" autoComplete="off" />
          </label>
          <label>
            One-time code
            <input value={credentialOtp} onChange={(event) => setCredentialOtp(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Notes
            <textarea value={credentialNotes} onChange={(event) => setCredentialNotes(event.target.value)} rows={3} />
          </label>
          <div className="actions">
            <button onClick={createCredentialSession} disabled={busy}>{busy ? "Working..." : "Create runtime session"}</button>
          </div>
          <p className="muted">Active session: {credentialSessionId || "none"}</p>
          <div className="list">
            {credentialSessions.map((session) => (
              <div key={session.id} className="list-item">
                <div>
                  <strong>{session.label || session.id}</strong>
                  <p className="muted">{session.expiresAt}</p>
                </div>
                <span className="pill running">active</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Plan</h2>
          {plan ? (
            <>
              <p className="muted">{plan.summary}</p>
              <ol className="timeline">
                {plan.steps.map((step) => (
                  <li key={step.id}>
                    <div className="step-head">
                      <strong>{step.title}</strong>
                      <span>{step.kind}</span>
                    </div>
                    <p>{step.details}</p>
                    {step.approvalReason ? <p className="approval-reason">{step.approvalReason}</p> : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">No plan yet.</p>
          )}
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Latest run</h2>
          {latestRun ? (
            <>
              <div className="status-row">
                <span className={`pill ${latestRun.status}`}>{latestRun.status}</span>
                <span>{latestRun.goal}</span>
              </div>
              <p className="muted">Checkpoint step {latestRun.checkpoint.stepIndex + 1}</p>
              {latestRun.checkpoint.awaitingApprovalForStepId ? (
                <p className="approval-reason">Approval required for step {latestRun.checkpoint.awaitingApprovalForStepId}</p>
              ) : null}
              <pre>{JSON.stringify(latestRun.outputs, null, 2)}</pre>
              <div className="actions">
                <button className="secondary" onClick={() => saveWorkflow(latestRun.id)} disabled={busy || latestRun.status !== "completed"}>
                  Save as workflow
                </button>
                <button className="secondary" onClick={() => approveAndResume(latestRun.id)} disabled={busy || latestRun.status !== "waiting_for_approval"}>
                  Approve and resume
                </button>
              </div>
            </>
          ) : (
            <p className="muted">No runs yet.</p>
          )}
        </article>

        <article className="panel">
          <h2>Workflows</h2>
          <div className="list">
            {workflows.map((workflow) => (
              <div key={workflow.id} className="list-item">
                <div>
                  <strong>{workflow.name}</strong>
                  <p className="muted">{workflow.description}</p>
                </div>
                <span className="pill workflow">saved</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Run history</h2>
          <div className="list">
            {runs.map((run) => (
              <div key={run.id} className="list-item">
                <div>
                  <strong>{run.goal}</strong>
                  <p className="muted">{run.createdAt}</p>
                  {run.error ? <p className="error-inline">{run.error}</p> : null}
                </div>
                <span className={`pill ${run.status}`}>{run.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Self-improvement</h2>
          <p className="muted">Internal agents observe runs, generate proposals, and create branches or draft PRs. They never merge to main.</p>
          <div className="actions">
            <button className="secondary" onClick={analyzeImprovement} disabled={busy}>
              {busy ? "Working..." : "Analyze history"}
            </button>
          </div>
          <h3>Agents</h3>
          <div className="list">
            {agents.map((agent) => (
              <div key={agent.id} className="list-item">
                <div>
                  <strong>{agent.title}</strong>
                  <p className="muted">{agent.mission}</p>
                </div>
                <span className="pill running">{agent.id}</span>
              </div>
            ))}
          </div>
          {improvementSummary ? (
            <>
              <h3>Latest analysis</h3>
              <pre>{JSON.stringify(improvementSummary, null, 2)}</pre>
              <div className="list">
                {improvementProposals.map((proposal) => (
                  <div key={proposal.id} className="list-item">
                    <div>
                      <strong>{proposal.title}</strong>
                      <p className="muted">{proposal.problem}</p>
                    </div>
                    <span className="pill">{proposal.targetAgent}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </article>
      </section>
    </div>
  );
}
