import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import type { BrowserActionSpec, GoalRequest, PlanStep, TaskPlan } from "./types.js";

const irreversibleVerbs = [
  "submit",
  "purchase",
  "pay",
  "buy",
  "send",
  "file",
  "delete",
  "cancel",
  "approve",
  "apply",
  "sign",
];

const browserVerbs = ["browser", "website", "web", "site", "form", "page", "click", "open", "navigate", "fill", "extract", "compare"];

function splitGoal(goal: string): string[] {
  return goal
    .replace(/\s+/g, " ")
    .split(/(?:,| then | and | after that | lastly | finally )/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferAction(clause: string): BrowserActionSpec | undefined {
  const lower = clause.toLowerCase();

  const urlMatch = clause.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    return { type: "goto", url: urlMatch[0] };
  }

  if (lower.includes("fill") || lower.includes("type")) {
    return { type: "fill", selector: "input, textarea", text: clause };
  }

  if (lower.includes("click") || lower.includes("select")) {
    return { type: "click", selector: "button, a, [role='button']", name: clause };
  }

  if (lower.includes("screenshot")) {
    return { type: "screenshot", path: "artifacts/screenshot.png" };
  }

  if (lower.includes("extract") || lower.includes("collect") || lower.includes("scrape")) {
    return { type: "extract", selector: "body" };
  }

  return undefined;
}

function stepFromClause(clause: string, index: number): PlanStep {
  const action = inferAction(clause);
  const lower = clause.toLowerCase();
  const needsApproval = irreversibleVerbs.some((verb) => lower.includes(verb));
  const isBrowserTask = browserVerbs.some((verb) => lower.includes(verb)) || Boolean(action);

  if (action) {
    return {
      id: createId(`step_${index}`),
      kind: "browser",
      title: clause,
      details: `Browser action derived from: ${clause}`,
      tool: "browser",
      retryLimit: 3,
      requiresApproval: needsApproval,
      browserAction: action,
      metadata: { sourceClause: clause },
    };
  }

  if (needsApproval) {
    return {
      id: createId(`step_${index}`),
      kind: "approval",
      title: clause,
      details: `Pause before irreversible action: ${clause}`,
      tool: "human",
      retryLimit: 0,
      requiresApproval: true,
      metadata: { sourceClause: clause },
    };
  }

  return {
    id: createId(`step_${index}`),
    kind: isBrowserTask ? "browser" : "analysis",
    title: clause,
    details: isBrowserTask ? `Browser-oriented clause: ${clause}` : `Analysis step derived from: ${clause}`,
    tool: isBrowserTask ? "browser" : "analysis",
    retryLimit: 2,
    metadata: { sourceClause: clause },
  };
}

export function planGoal(request: GoalRequest): TaskPlan {
  const clauses = splitGoal(request.goal);
  const browserHeavy = clauses.some((clause) => browserVerbs.some((verb) => clause.toLowerCase().includes(verb)));
  const steps: PlanStep[] = [];

  steps.push({
    id: createId("step_0"),
    kind: "analysis",
    title: "Clarify objective and constraints",
    details: request.context ? `Use provided context and inputs. Context: ${request.context}` : "Derive the task shape and identify required inputs.",
    tool: "planner",
    retryLimit: 0,
    metadata: { inputs: request.inputs ?? {} },
  });

  if (browserHeavy || clauses.length > 1) {
    steps.push({
      id: createId("step_inputs"),
      kind: "analysis",
      title: "Collect data and execution prerequisites",
      details: "Confirm company details, target sites, approval requirements, and output format.",
      tool: "planner",
      retryLimit: 0,
    });
  }

  clauses.forEach((clause, index) => {
    steps.push(stepFromClause(clause, index + 1));
  });

  if (/spreadsheet|sheet|csv|table|report|compare/i.test(request.goal)) {
    steps.push({
      id: createId("step_result"),
      kind: "data",
      title: "Consolidate results for review",
      details: "Normalize collected data and make it ready for a spreadsheet, report, or structured export.",
      tool: "analysis",
      retryLimit: 1,
    });
  }

  steps.push({
    id: createId("step_wrapup"),
    kind: "checkpoint",
    title: "Checkpoint and persist history",
    details: "Persist execution history, outputs, and workflow candidates.",
    tool: "workflow",
    retryLimit: 0,
  });

  return {
    id: createId("plan"),
    goal: request.goal,
    summary: `Plan with ${steps.length} steps covering analysis, browser execution, and persistence.`,
    createdAt: nowIso(),
    assumptions: [
      "The user will review any approval gates before irreversible actions.",
      "Browser steps may need selectors refined once target sites are known.",
      "Structured outputs will be persisted locally inside .legwork.",
    ],
    steps,
  };
}
