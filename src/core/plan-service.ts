import { z } from "zod";
import { planGoal } from "./planner.js";
import type { BrowserActionSpec, GoalRequest, PlanStep, TaskPlan } from "./types.js";
import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";

const planSchema = z.object({
  goal: z.string(),
  summary: z.string(),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(
    z.object({
      kind: z.enum(["analysis", "browser", "approval", "data", "checkpoint", "auth"]),
      title: z.string(),
      details: z.string(),
      tool: z.enum(["planner", "browser", "human", "analysis", "workflow"]),
      requiresApproval: z.boolean().optional(),
      approvalReason: z.string().optional(),
      retryLimit: z.number().int().min(0).max(10).optional(),
      browserAction: z
        .object({
          type: z.enum(["goto", "click", "fill", "type", "select", "check", "uncheck", "upload", "extract", "screenshot", "login", "wait"]),
          url: z.string().optional(),
          selector: z.string().optional(),
          role: z.string().optional(),
          name: z.string().optional(),
          label: z.string().optional(),
          placeholder: z.string().optional(),
          text: z.string().optional(),
          path: z.string().optional(),
          value: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
          filePath: z.string().optional(),
          credentialRef: z.string().optional(),
          submitSelector: z.string().optional(),
          waitFor: z.string().optional(),
          timeoutMs: z.number().optional(),
        })
        .optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

function buildBrowserAction(action: z.infer<typeof planSchema>["steps"][number]["browserAction"]): BrowserActionSpec | undefined {
  if (!action) {
    return undefined;
  }

  return {
    type: action.type,
    ...(action.url ? { url: action.url } : {}),
    ...(action.selector ? { selector: action.selector } : {}),
    ...(action.role ? { role: action.role } : {}),
    ...(action.name ? { name: action.name } : {}),
    ...(action.label ? { label: action.label } : {}),
    ...(action.placeholder ? { placeholder: action.placeholder } : {}),
    ...(action.text ? { text: action.text } : {}),
    ...(action.path ? { path: action.path } : {}),
    ...(typeof action.value !== "undefined" ? { value: action.value } : {}),
    ...(action.filePath ? { filePath: action.filePath } : {}),
    ...(action.credentialRef ? { credentialRef: action.credentialRef } : {}),
    ...(action.submitSelector ? { submitSelector: action.submitSelector } : {}),
    ...(action.waitFor ? { waitFor: action.waitFor } : {}),
    ...(typeof action.timeoutMs === "number" ? { timeoutMs: action.timeoutMs } : {}),
  };
}

function toTaskPlan(goal: string, raw: z.infer<typeof planSchema>): TaskPlan {
  return {
    id: createId("plan"),
    goal,
    summary: raw.summary,
    createdAt: nowIso(),
    assumptions: raw.assumptions,
    steps: raw.steps.map((step, index): PlanStep => {
      const browserAction = buildBrowserAction(step.browserAction);
      return {
        id: createId(`step_${index}`),
        kind: step.kind,
        title: step.title,
        details: step.details,
        tool: step.tool,
        ...(typeof step.requiresApproval === "boolean" ? { requiresApproval: step.requiresApproval } : {}),
        ...(step.approvalReason ? { approvalReason: step.approvalReason } : {}),
        ...(typeof step.retryLimit === "number" ? { retryLimit: step.retryLimit } : {}),
        ...(browserAction ? { browserAction } : {}),
        ...(step.metadata ? { metadata: step.metadata } : {}),
      };
    }),
  };
}

async function tryOpenAIPlanning(request: GoalRequest): Promise<TaskPlan | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const model = process.env.OPENAI_PLANNER_MODEL ?? "gpt-4.1-mini";
  const context = typeof request.context === "string" ? request.context : JSON.stringify(request.context ?? {});

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are Legwork's planning engine. Return only a JSON object that describes a safe, executable plan for a personal virtual assistant. Keep approval gates focused on login confirmation, irreversible changes, account-state changes, and payments.",
        },
        {
          role: "user",
          content: `Goal: ${request.goal}\nContext: ${context}\nInputs: ${JSON.stringify(request.inputs ?? {})}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "legwork_task_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              goal: { type: "string" },
              summary: { type: "string" },
              assumptions: { type: "array", items: { type: "string" } },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    kind: { type: "string", enum: ["analysis", "browser", "approval", "data", "checkpoint", "auth"] },
                    title: { type: "string" },
                    details: { type: "string" },
                    tool: { type: "string", enum: ["planner", "browser", "human", "analysis", "workflow"] },
                    requiresApproval: { type: "boolean" },
                    approvalReason: { type: "string" },
                    retryLimit: { type: "integer" },
                    browserAction: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["goto", "click", "fill", "type", "select", "check", "uncheck", "upload", "extract", "screenshot", "login", "wait"],
                        },
                        url: { type: "string" },
                        selector: { type: "string" },
                        role: { type: "string" },
                        name: { type: "string" },
                        label: { type: "string" },
                        placeholder: { type: "string" },
                        text: { type: "string" },
                        path: { type: "string" },
                        value: { anyOf: [{ type: "string" }, { type: "boolean" }, { type: "array", items: { type: "string" } }] },
                        filePath: { type: "string" },
                        credentialRef: { type: "string" },
                        submitSelector: { type: "string" },
                        waitFor: { type: "string" },
                        timeoutMs: { type: "number" },
                      },
                    },
                    metadata: { type: "object" },
                  },
                  required: ["kind", "title", "details", "tool"],
                },
              },
            },
            required: ["goal", "summary", "assumptions", "steps"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((chunk) => chunk.text ?? "").join("\n");
  if (!text?.trim()) {
    return undefined;
  }

  const parsed = planSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return undefined;
  }

  return toTaskPlan(request.goal, parsed.data);
}

export async function createPlan(request: GoalRequest): Promise<TaskPlan> {
  const llmPlan = await tryOpenAIPlanning(request).catch(() => undefined);
  if (llmPlan) {
    return llmPlan;
  }
  return planGoal(request);
}
