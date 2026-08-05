import { join } from "node:path";
import { workflowsDir } from "../shared/config.js";
import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { readJson, writeJson } from "../shared/fs.js";
import type { RunRecord, WorkflowDefinition } from "../core/types.js";

export class WorkflowStore {
  constructor(private readonly baseDir = workflowsDir) {}

  private filePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  async save(workflow: WorkflowDefinition): Promise<void> {
    await writeJson(this.filePath(workflow.id), workflow);
  }

  async list(): Promise<WorkflowDefinition[]> {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(this.baseDir).catch(() => []);
    const workflows = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => readJson<WorkflowDefinition | undefined>(join(this.baseDir, file), undefined)),
    );
    return workflows.filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
  }

  async load(id: string): Promise<WorkflowDefinition | undefined> {
    return readJson<WorkflowDefinition | undefined>(this.filePath(id), undefined);
  }

  async saveFromRun(run: RunRecord, name?: string): Promise<WorkflowDefinition> {
    const workflow: WorkflowDefinition = {
      id: createId("workflow"),
      name: name ?? `Workflow from ${run.goal.slice(0, 42)}`,
      description: `Captured from successful run ${run.id}`,
      createdAt: nowIso(),
      sourceRunId: run.id,
      plan: run.planSnapshot,
      inputsSchema: { type: "object", properties: {} },
      outputsSchema: { type: "object", properties: {} },
    };
    await this.save(workflow);
    return workflow;
  }

  replay(workflow: WorkflowDefinition, overrides: Record<string, unknown> = {}): { goal: string; inputs: Record<string, unknown> } {
    return {
      goal: workflow.plan.goal,
      inputs: overrides,
    };
  }

  toMermaid(workflow: WorkflowDefinition): string {
    const lines = workflow.plan.steps.map((step, index) => `  S${index}[${JSON.stringify(step.title)}]`);
    const edges = workflow.plan.steps.slice(0, -1).map((_, index) => `  S${index} --> S${index + 1}`);
    return ["flowchart TD", ...lines, ...edges].join("\n");
  }
}
