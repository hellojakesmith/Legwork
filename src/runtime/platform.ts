import { FileRunStore } from "../storage/file-run-store.js";
import { ExecutionEngine } from "../core/execution-engine.js";
import { WorkflowStore } from "../workflows/workflow-store.js";
import { planGoal } from "../core/planner.js";
import { createPlan } from "../core/plan-service.js";
import { PlaywrightBrowserAgent } from "../browser/playwright-browser-agent.js";
import { ImprovementController } from "../improvement/controller.js";
import { SessionRegistry } from "./session-registry.js";

export function createPlatform() {
  const runStore = new FileRunStore();
  const workflowStore = new WorkflowStore();
  const engine = new ExecutionEngine(runStore);
  const improvement = new ImprovementController();
  const sessions = new SessionRegistry();

  return {
    runStore,
    workflowStore,
    engine,
    improvement,
    sessions,
    planGoal,
    createPlan,
    createBrowserAgent: () => new PlaywrightBrowserAgent(true),
  };
}
