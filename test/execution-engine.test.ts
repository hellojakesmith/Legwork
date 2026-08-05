import { describe, expect, it } from "vitest";
import { ExecutionEngine, type RunStorage } from "../src/core/execution-engine.js";
import type { BrowserActionContext, BrowserAgent } from "../src/browser/browser-agent.js";
import type { RunRecord, TaskPlan } from "../src/core/types.js";

class MemoryRunStore implements RunStorage {
  private runs = new Map<string, RunRecord>();

  async save(run: RunRecord): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async load(id: string): Promise<RunRecord | undefined> {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  async list(): Promise<RunRecord[]> {
    return [...this.runs.values()].map((run) => structuredClone(run));
  }
}

class FakeBrowserAgent implements BrowserAgent {
  public opened: string[] = [];

  async open(url: string, _context: BrowserActionContext): Promise<void> {
    this.opened.push(url);
  }

  async click(): Promise<void> {}
  async fill(): Promise<void> {}
  async type(): Promise<void> {}
  async extractText(): Promise<string> {
    return "fake";
  }
  async screenshot(): Promise<string> {
    return "artifact.png";
  }
  async close(): Promise<void> {}
}

describe("ExecutionEngine", () => {
  it("pauses for approval and resumes from the checkpoint", async () => {
    const storage = new MemoryRunStore();
    const engine = new ExecutionEngine(storage);
    const browser = new FakeBrowserAgent();
    const plan: TaskPlan = {
      id: "plan_test",
      goal: "Visit example.com",
      summary: "visit site",
      createdAt: new Date().toISOString(),
      assumptions: [],
      steps: [
        {
          id: "step_1",
          kind: "browser",
          title: "Open example.com",
          details: "Navigate to the example site",
          tool: "browser",
          requiresApproval: true,
          retryLimit: 0,
          browserAction: { type: "goto", url: "https://example.com" },
        },
        {
          id: "step_2",
          kind: "analysis",
          title: "Summarize",
          details: "Summarize the page",
          tool: "analysis",
          retryLimit: 0,
        },
      ],
    };

    const run = await engine.start(plan, { browserAgent: browser });
    expect(run.status).toBe("waiting_for_approval");
    expect(browser.opened).toEqual([]);

    await engine.approve(run.id, storage);
    const resumed = await engine.resume(run.id, { browserAgent: browser });

    expect(resumed.status).toBe("completed");
    expect(browser.opened).toEqual(["https://example.com"]);
  });
});
