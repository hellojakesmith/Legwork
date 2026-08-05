import { useEffect, useMemo, useState } from "react";

type PlanStep = {
  id: string;
  title: string;
  details: string;
  kind: string;
  requiresApproval?: boolean;
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

export function App() {
  const [goal, setGoal] = useState("Compare business insurance providers, gather quotes, and save the results to a spreadsheet.");
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [runData, workflowData] = await Promise.all([
      api<RunRecord[]>("/api/runs"),
      api<WorkflowDefinition[]>("/api/workflows"),
    ]);
    setRuns(runData);
    setWorkflows(workflowData);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  const latestRun = useMemo(() => runs[0], [runs]);

  async function handlePlan() {
    setBusy(true);
    setError(null);
    try {
      const nextPlan = await api<TaskPlan>("/api/plan", {
        method: "POST",
        body: JSON.stringify({ goal, context }),
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
    try {
      await api<RunRecord>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ goal, context, plan }),
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
    try {
      await api(`/api/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Legwork</p>
          <h1>Autonomous browser work with controlled self-improvement.</h1>
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
            Context
            <textarea value={context} onChange={(event) => setContext(event.target.value)} rows={3} placeholder="Company details, constraints, approvals, target systems" />
          </label>
          <div className="actions">
            <button onClick={handlePlan} disabled={busy}>{busy ? "Working..." : "Generate plan"}</button>
            <button onClick={handleRun} className="secondary" disabled={busy}>{busy ? "Working..." : "Run plan"}</button>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <section className="grid">
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
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">No plan yet.</p>
          )}
        </article>

        <article className="panel">
          <h2>Latest run</h2>
          {latestRun ? (
            <>
              <div className="status-row">
                <span className={`pill ${latestRun.status}`}>{latestRun.status}</span>
                <span>{latestRun.goal}</span>
              </div>
              <p className="muted">Checkpoint step {latestRun.checkpoint.stepIndex + 1}</p>
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
                </div>
                <span className={`pill ${run.status}`}>{run.status}</span>
              </div>
            ))}
          </div>
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
    </div>
  );
}
