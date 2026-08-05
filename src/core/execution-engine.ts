import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { BrowserChallengeError, type BrowserActionContext, type BrowserAgent } from "../browser/browser-agent.js";
import type { BrowserActionSpec, PlanStep, RunCheckpoint, RunEvent, RunRecord, TaskPlan } from "./types.js";
import type { RuntimeCredentials } from "./types.js";

export interface RunStorage {
  save(run: RunRecord): Promise<void>;
  load(id: string): Promise<RunRecord | undefined>;
  list(): Promise<RunRecord[]>;
}

export interface ExecutionOptions {
  browserAgent?: BrowserAgent;
  requireApprovalFor?: (step: PlanStep) => boolean;
  onEvent?: (event: RunEvent) => void;
  continueFromCheckpoint?: RunCheckpoint;
  credentialSessionId?: string;
  resolveCredentials?: (credentialSessionId: string) => Promise<RuntimeCredentials | undefined>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBrowserStep(step: PlanStep): boolean {
  return step.kind === "browser" && Boolean(step.browserAction);
}

function createEvent(type: RunEvent["type"], message: string, stepId?: string, data?: Record<string, unknown>): RunEvent {
  return {
    id: createId("event"),
    at: nowIso(),
    type,
    message,
    ...(stepId ? { stepId } : {}),
    ...(data ? { data } : {}),
  };
}

function createBrowserContext(
  runId: string,
  stepId: string,
  emit: (event: RunEvent) => void,
  options: ExecutionOptions,
): BrowserActionContext {
  return {
    runId,
    stepId,
    emit,
    ...(options.credentialSessionId ? { credentialSessionId: options.credentialSessionId } : {}),
    ...(options.resolveCredentials ? { resolveCredentials: options.resolveCredentials } : {}),
  } satisfies BrowserActionContext;
}

async function executeBrowserAction(
  browserAgent: BrowserAgent,
  step: PlanStep,
  run: RunRecord,
  emit: (event: RunEvent) => void,
  options: ExecutionOptions,
): Promise<unknown> {
  const action = step.browserAction as BrowserActionSpec;
  const context = createBrowserContext(run.id, step.id, emit, options);

  switch (action.type) {
    case "goto":
      if (!action.url) throw new Error("Browser goto step missing url");
      await browserAgent.open(action.url, context);
      return { url: action.url };
    case "click":
      await browserAgent.click(action, context);
      return { clicked: action.selector ?? action.name ?? action.role };
    case "fill":
      if (typeof action.text !== "string") throw new Error("Browser fill step missing text");
      await browserAgent.fill(action as { selector?: string; label?: string; placeholder?: string; text: string }, context);
      return { filled: action.selector ?? action.label ?? action.placeholder };
    case "type":
      if (typeof action.text !== "string") throw new Error("Browser type step missing text");
      await browserAgent.type(action as { selector?: string; text: string }, context);
      return { typed: action.selector };
    case "extract":
      return { text: await browserAgent.extractText(action, context) };
    case "login":
      await browserAgent.login(action, context);
      return { authenticated: true };
    case "select":
      if (typeof action.value !== "string" && !Array.isArray(action.value)) throw new Error("Browser select step missing value");
      await browserAgent.select(action as { selector?: string; label?: string; value: string | string[] }, context);
      return { selected: action.value };
    case "check":
      await browserAgent.check(action, context);
      return { checked: true };
    case "uncheck":
      await browserAgent.uncheck(action, context);
      return { unchecked: true };
    case "upload":
      if (!action.filePath) throw new Error("Browser upload step missing filePath");
      await browserAgent.upload(action as { selector?: string; filePath: string }, context);
      return { uploaded: action.filePath };
    case "wait":
      await browserAgent.wait(
        {
          ...(action.waitFor ? { selector: action.waitFor } : {}),
          ...(typeof action.timeoutMs === "number" ? { timeoutMs: action.timeoutMs } : {}),
        },
        context,
      );
      return { waited: true };
    case "screenshot":
      return { path: await browserAgent.screenshot(action, context) };
    default:
      throw new Error(`Unsupported browser action: ${JSON.stringify(action)}`);
  }
}

export class ExecutionEngine {
  constructor(private readonly storage: RunStorage) {}

  private async execute(run: RunRecord, plan: TaskPlan, options: ExecutionOptions = {}): Promise<RunRecord> {
    if (run.events.length === 0) {
      run.events.push(createEvent("run.started", `Run started for goal: ${plan.goal}`));
    }
    run.status = "running";
    run.updatedAt = nowIso();
    await this.storage.save(run);

    const emit = async (event: RunEvent) => {
      run.events.push(event);
      run.updatedAt = nowIso();
      options.onEvent?.(event);
      await this.storage.save(run);
    };

    const browserAgent = options.browserAgent;
    try {
      const startIndex = run.checkpoint.stepIndex;
      for (let i = startIndex; i < plan.steps.length; i += 1) {
        const step = plan.steps[i]!;
        run.checkpoint.stepIndex = i;
        await emit(createEvent("run.step.started", `Starting step ${i + 1}: ${step.title}`, step.id, { index: i, kind: step.kind }));

        const approvalRequired = step.kind === "approval" || options.requireApprovalFor?.(step) || step.requiresApproval;
        const approvalGranted = run.checkpoint.approvedStepId === step.id;
        if (approvalRequired && !approvalGranted) {
          run.status = "waiting_for_approval";
          run.checkpoint.awaitingApprovalForStepId = step.id;
          await emit(createEvent("run.approval.required", `Approval required before step: ${step.title}`, step.id));
          return run;
        }

        const retries = step.retryLimit ?? 0;
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          try {
            const output = isBrowserStep(step) && browserAgent
              ? await executeBrowserAction(browserAgent, step, run, async (event) => {
                  await emit(event);
                }, options)
              : { note: step.details };

            if (output !== undefined) {
              run.outputs.push({ label: step.title, value: output });
            }
            await emit(createEvent("run.step.completed", `Completed step: ${step.title}`, step.id, { attempt, output }));
            lastError = undefined;
            break;
          } catch (error) {
            if (error instanceof BrowserChallengeError) {
              await emit(createEvent("browser.challenge", error.challenge.message, step.id, { challengeType: error.challenge.type }));
              run.status = "waiting_for_approval";
              run.checkpoint.awaitingApprovalForStepId = step.id;
              await emit(createEvent("run.approval.required", error.challenge.message, step.id, { challengeType: error.challenge.type }));
              return run;
            }
            lastError = error;
            await emit(createEvent("run.step.failed", error instanceof Error ? error.message : String(error), step.id, { attempt }));
            if (attempt < retries) {
              await delay(250 * (attempt + 1));
              continue;
            }
          }
        }

        if (lastError) {
          throw lastError;
        }

        delete run.checkpoint.awaitingApprovalForStepId;
        delete run.checkpoint.approvedStepId;
        run.checkpoint.stepIndex = i + 1;
        await this.storage.save(run);
      }

      run.status = "completed";
      run.completedAt = nowIso();
      run.updatedAt = nowIso();
      await emit(createEvent("run.completed", `Run completed for goal: ${plan.goal}`));
      return run;
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.stack ?? error.message : String(error);
      await emit(createEvent("run.failed", run.error));
      run.updatedAt = nowIso();
      throw error;
    } finally {
      if (run.status !== "waiting_for_approval") {
        await browserAgent?.close().catch(() => undefined);
      }
    }
  }

  async start(plan: TaskPlan, options: ExecutionOptions = {}): Promise<RunRecord> {
    const run: RunRecord = {
      id: createId("run"),
      goal: plan.goal,
      planId: plan.id,
      status: "running",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: nowIso(),
      checkpoint: {
        stepIndex: options.continueFromCheckpoint?.stepIndex ?? 0,
        ...(options.continueFromCheckpoint?.awaitingApprovalForStepId
          ? { awaitingApprovalForStepId: options.continueFromCheckpoint.awaitingApprovalForStepId }
          : {}),
        ...(options.continueFromCheckpoint?.approvedStepId
          ? { approvedStepId: options.continueFromCheckpoint.approvedStepId }
          : {}),
      },
      outputs: [],
      events: [],
      planSnapshot: plan,
    };

    await this.storage.save(run);
    return this.execute(run, plan, options);
  }

  async resume(runId: string, options: ExecutionOptions = {}): Promise<RunRecord> {
    const run = await this.storage.load(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    if (run.status !== "waiting_for_approval" && run.status !== "running") {
      throw new Error(`Run ${runId} cannot be resumed from status ${run.status}`);
    }
    return this.execute(run, run.planSnapshot, {
      ...options,
      continueFromCheckpoint: run.checkpoint,
    });
  }

  async approve(runId: string, storage: RunStorage, onEvent?: (event: RunEvent) => void): Promise<RunRecord> {
    const run = await storage.load(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    if (run.status !== "waiting_for_approval") {
      throw new Error(`Run ${runId} is not waiting for approval`);
    }
    const stepId = run.checkpoint.awaitingApprovalForStepId;
    run.status = "running";
    delete run.checkpoint.awaitingApprovalForStepId;
    if (stepId) {
      run.checkpoint.approvedStepId = stepId;
    }
    run.updatedAt = nowIso();
    const event = createEvent("run.approval.granted", `Approval granted for step ${stepId ?? "unknown"}`, stepId);
    run.events.push(event);
    onEvent?.(event);
    await storage.save(run);
    return run;
  }
}
