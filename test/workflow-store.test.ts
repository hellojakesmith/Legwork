import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowStore } from "../src/workflows/workflow-store.js";
import { planGoal } from "../src/core/planner.js";

describe("WorkflowStore", () => {
  it("saves and loads workflows", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "legwork-workflow-"));
    const store = new WorkflowStore(baseDir);
    const run = {
      id: "run_test",
      goal: "Check a website",
      planId: "plan_test",
      status: "completed" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoint: { stepIndex: 1 },
      outputs: [],
      events: [],
      planSnapshot: planGoal({ goal: "Check a website" }),
    };

    const saved = await store.saveFromRun(run, "Website check");
    const loaded = await store.load(saved.id);

    expect(loaded?.name).toBe("Website check");
    expect(store.toMermaid(saved)).toContain("flowchart TD");
  });
});
