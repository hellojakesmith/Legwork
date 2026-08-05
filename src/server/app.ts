import express from "express";
import cors from "cors";
import { browserArtifactsDir } from "../shared/config.js";
import { createPlatform } from "../runtime/platform.js";
import { PlaywrightBrowserAgent } from "../browser/playwright-browser-agent.js";
import type { BrowserAgent } from "../browser/browser-agent.js";
import type { TaskPlan } from "../core/types.js";
import type { GoalContext, RuntimeCredentials } from "../core/types.js";

const platform = createPlatform();

function attachExecutionLifecycle(browserAgent: BrowserAgent | null, credentialSessionId?: string) {
  return (event: { type: string }, run?: { id: string }) => {
    const runId = run?.id;
    if (!runId) {
      return;
    }
    if ((event.type === "run.approval.required" || event.type === "browser.challenge") && browserAgent) {
      platform.sessions.setBrowserSession(runId, browserAgent);
    }
    if (event.type === "run.completed" || event.type === "run.failed") {
      platform.sessions.clearBrowserSession(runId);
      platform.sessions.clearRunCredentialSession(runId);
    }
    if (credentialSessionId) {
      platform.sessions.setRunCredentialSession(runId, credentialSessionId);
    }
  };
}

export const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/artifacts", express.static(browserArtifactsDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "legwork" });
});

app.get("/api/agents", (_req, res) => {
  res.json(platform.improvement.agents());
});

app.get("/api/credential-sessions", (_req, res) => {
  res.json(platform.sessions.credentialVault.list().map((session) => ({
    id: session.id,
    label: session.label,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  })));
});

app.post("/api/credential-sessions", (req, res) => {
  const credentials = req.body?.credentials as RuntimeCredentials | undefined;
  if (!credentials || typeof credentials !== "object") {
    res.status(400).json({ error: "credentials are required" });
    return;
  }
  const label = typeof req.body?.label === "string" ? req.body.label : undefined;
  const ttlMs = typeof req.body?.ttlMs === "number" ? req.body.ttlMs : undefined;
  const session = platform.sessions.credentialVault.create({ label, credentials, ttlMs });
  res.status(201).json({
    id: session.id,
    label: session.label,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
});

app.delete("/api/credential-sessions/:id", (req, res) => {
  const deleted = platform.sessions.credentialVault.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "credential session not found" });
    return;
  }
  res.status(204).end();
});

app.post("/api/plan", async (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
  const context = typeof req.body?.context === "string" || (req.body?.context && typeof req.body.context === "object")
    ? (req.body.context as string | GoalContext)
    : undefined;
  const inputs = req.body?.inputs && typeof req.body.inputs === "object" ? (req.body.inputs as Record<string, unknown>) : undefined;

  if (!goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  const plan = await platform.createPlan({
    goal,
    ...(context ? { context } : {}),
    ...(inputs ? { inputs } : {}),
  });
  res.json(plan satisfies TaskPlan);
});

app.get("/api/runs", async (_req, res) => {
  res.json(await platform.runStore.list());
});

app.get("/api/runs/:id", async (req, res) => {
  const run = await platform.runStore.load(req.params.id);
  if (!run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  res.json(run);
});

app.post("/api/runs", async (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
  if (!goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  const context = typeof req.body?.context === "string" || (req.body?.context && typeof req.body.context === "object")
    ? (req.body.context as string | GoalContext)
    : undefined;
  const credentialSessionId = typeof req.body?.credentialSessionId === "string" ? req.body.credentialSessionId : undefined;
  const plan = req.body?.plan
    ? (req.body.plan as TaskPlan)
    : await platform.createPlan({
        goal,
        ...(context ? { context } : {}),
        ...(req.body?.inputs && typeof req.body.inputs === "object" ? { inputs: req.body.inputs as Record<string, unknown> } : {}),
      });
  const browserMode = req.body?.browser !== false;
  const browserAgent = browserMode ? new PlaywrightBrowserAgent(true) : null;

  try {
    const run = await platform.engine.startDetached(plan, {
      ...(browserAgent ? { browserAgent } : {}),
      ...(credentialSessionId ? { credentialSessionId } : {}),
      ...(credentialSessionId
        ? {
            resolveCredentials: async (id) => platform.sessions.credentialVault.get(id)?.credentials,
          }
        : {}),
      onEvent: attachExecutionLifecycle(browserAgent, credentialSessionId),
    });
    if (credentialSessionId) {
      platform.sessions.setRunCredentialSession(run.id, credentialSessionId);
    }
    res.status(202).json(run);
  } catch (error) {
    if (browserAgent) {
      await browserAgent.close().catch(() => undefined);
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/runs/:id/approve", async (req, res) => {
  try {
    await platform.engine.approve(req.params.id, platform.runStore);
    const browserAgent = platform.sessions.takeBrowserSession(req.params.id) ?? ((typeof req.body?.browser !== "boolean" || req.body.browser) ? new PlaywrightBrowserAgent(true) : undefined);
    const credentialSessionId = typeof req.body?.credentialSessionId === "string"
      ? req.body.credentialSessionId
      : platform.sessions.getRunCredentialSession(req.params.id);
    const run = await platform.engine.resumeDetached(req.params.id, {
      ...(browserAgent ? { browserAgent } : {}),
      ...(credentialSessionId ? { credentialSessionId } : {}),
      ...(credentialSessionId
        ? {
            resolveCredentials: async (id) => platform.sessions.credentialVault.get(id)?.credentials,
          }
        : {}),
      onEvent: attachExecutionLifecycle(browserAgent ?? null, credentialSessionId),
    });
    if (credentialSessionId) {
      platform.sessions.setRunCredentialSession(run.id, credentialSessionId);
    }
    res.status(202).json(run);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/runs/:id/workflow", async (req, res) => {
  const run = await platform.runStore.load(req.params.id);
  if (!run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  const workflow = await platform.workflowStore.saveFromRun(run, typeof req.body?.name === "string" ? req.body.name : undefined);
  res.status(201).json({ workflow, mermaid: platform.workflowStore.toMermaid(workflow) });
});

app.get("/api/workflows", async (_req, res) => {
  res.json(await platform.workflowStore.list());
});

app.get("/api/workflows/:id", async (req, res) => {
  const workflow = await platform.workflowStore.load(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: "workflow not found" });
    return;
  }
  res.json({ workflow, mermaid: platform.workflowStore.toMermaid(workflow) });
});

app.post("/api/improvement/analyze", async (_req, res) => {
  const runs = await platform.runStore.list();
  const result = await platform.improvement.analyze(runs);
  res.json(result);
});

app.post("/api/improvement/branch", async (req, res) => {
  const proposalTitle = typeof req.body?.title === "string" ? req.body.title : "legwork-improvement";
  try {
    const result = await platform.improvement.prepareImplementationBranch(proposalTitle);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/improvement/pr", async (req, res) => {
  try {
    const url = await platform.improvement.openDraftPullRequest(
      typeof req.body?.branchName === "string" ? req.body.branchName : "",
      typeof req.body?.title === "string" ? req.body.title : "Legwork improvement",
      typeof req.body?.body === "string" ? req.body.body : "Automated improvement proposal",
    );
    res.status(201).json(url);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
