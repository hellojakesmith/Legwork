import express from "express";
import cors from "cors";
import { createPlatform } from "../runtime/platform.js";
import { planGoal } from "../core/planner.js";
import { PlaywrightBrowserAgent } from "../browser/playwright-browser-agent.js";
import type { TaskPlan } from "../core/types.js";

const platform = createPlatform();

export const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "legwork" });
});

app.get("/api/agents", (_req, res) => {
  res.json(platform.improvement.agents());
});

app.post("/api/plan", (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
  const context = typeof req.body?.context === "string" ? req.body.context : undefined;
  const inputs = req.body?.inputs && typeof req.body.inputs === "object" ? (req.body.inputs as Record<string, unknown>) : undefined;

  if (!goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  const plan = planGoal({
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

  const plan = req.body?.plan
    ? (req.body.plan as TaskPlan)
    : planGoal({
        goal,
        ...(typeof req.body?.context === "string" ? { context: req.body.context } : {}),
        ...(req.body?.inputs && typeof req.body.inputs === "object" ? { inputs: req.body.inputs as Record<string, unknown> } : {}),
      });
  const browserMode = req.body?.browser !== false;
  const browserAgent = browserMode ? new PlaywrightBrowserAgent(true) : null;

  try {
    const run = await platform.engine.start(plan, {
      ...(browserAgent ? { browserAgent } : {}),
    });
    res.status(201).json(run);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/runs/:id/approve", async (req, res) => {
  try {
    await platform.engine.approve(req.params.id, platform.runStore);
    const run = await platform.engine.resume(req.params.id, {
      ...(typeof req.body?.browser !== "boolean" || req.body.browser ? { browserAgent: new PlaywrightBrowserAgent(true) } : {}),
    });
    res.json(run);
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
