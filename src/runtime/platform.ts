import { FileRunStore } from "../storage/file-run-store.js";
import { ExecutionEngine } from "../core/execution-engine.js";
import { WorkflowStore } from "../workflows/workflow-store.js";
import { planGoal } from "../core/planner.js";
import { PlaywrightBrowserAgent } from "../browser/playwright-browser-agent.js";
import { ImprovementController } from "../improvement/controller.js";

export function createPlatform() {
  const runStore = new FileRunStore();
  const workflowStore = new WorkflowStore();
  const engine = new ExecutionEngine(runStore);
  const improvement = new ImprovementController();

  return {
    runStore,
    workflowStore,
    engine,
    improvement,
    planGoal,
    createBrowserAgent: () => new PlaywrightBrowserAgent(true),
  };
}
