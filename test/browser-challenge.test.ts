import { describe, expect, it } from "vitest";
import { ExecutionEngine, type RunStorage } from "../src/core/execution-engine.js";
import type { BrowserActionContext, BrowserAgent } from "../src/browser/browser-agent.js";
import { BrowserChallengeError } from "../src/browser/browser-agent.js";
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

class ChallengingBrowserAgent implements BrowserAgent {
  async open(_url: string, _context: BrowserActionContext): Promise<void> {
    throw new BrowserChallengeError({ type: "captcha", message: "CAPTCHA detected" });
  }

  async click(): Promise<void> {}
  async fill(): Promise<void> {}
  async type(): Promise<void> {}
  async select(): Promise<void> {}
  async check(): Promise<void> {}
  async uncheck(): Promise<void> {}
  async upload(): Promise<void> {}
  async login(): Promise<void> {}
  async wait(): Promise<void> {}
  async extractText(): Promise<string> {
    return "";
  }
  async extractStructured(): Promise<unknown> {
    return {};
  }
  async screenshot(): Promise<string> {
    return "shot.png";
  }
  async close(): Promise<void> {}
}

describe("Browser challenge handling", () => {
  it("pauses for human review when a CAPTCHA is detected", async () => {
    const storage = new MemoryRunStore();
    const engine = new ExecutionEngine(storage);
    const plan: TaskPlan = {
      id: "plan_test",
      goal: "Open a login page",
      summary: "open login page",
      createdAt: new Date().toISOString(),
      assumptions: [],
      steps: [
        {
          id: "step_1",
          kind: "browser",
          title: "Open login page",
          details: "Open a page that triggers a CAPTCHA",
          tool: "browser",
          retryLimit: 0,
          browserAction: { type: "goto", url: "https://example.com/login" },
        },
      ],
    };

    const run = await engine.start(plan, { browserAgent: new ChallengingBrowserAgent() });
    expect(run.status).toBe("waiting_for_approval");
    expect(run.events.some((event) => event.type === "browser.challenge")).toBe(true);
  });
});
