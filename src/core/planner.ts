import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { normalizeGoalContext } from "./context.js";
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
  "withdraw",
  "transfer",
];

const browserVerbs = ["browser", "website", "web", "site", "form", "page", "click", "open", "navigate", "fill", "extract", "compare", "upload", "download"];
const authVerbs = ["login", "log in", "sign in", "authenticate", "account", "dashboard", "portal", "member"];
const searchVerbs = ["search", "find", "lookup", "research", "compare", "review", "browse"];
const saveVerbs = ["save", "export", "report", "spreadsheet", "sheet", "csv", "document", "summary"];

function splitGoal(goal: string): string[] {
  return goal
    .replace(/\s+/g, " ")
    .split(/(?:,| then | and | after that | lastly | finally )/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasIntent(goal: string, phrases: string[]): boolean {
  const lower = goal.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase));
}

function buildSearchUrl(goal: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(goal)}`;
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

  if (lower.includes("login") || lower.includes("log in") || lower.includes("sign in") || lower.includes("authenticate")) {
    return { type: "login", submitSelector: "button[type='submit'], button, input[type='submit']" };
  }

  if (lower.includes("click") || lower.includes("select")) {
    return { type: "click", selector: "button, a, [role='button']", name: clause };
  }

  if (lower.includes("check") || lower.includes("toggle")) {
    return { type: "check", selector: "input[type='checkbox']" };
  }

  if (lower.includes("upload")) {
    return { type: "upload", selector: "input[type='file']" };
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
  const needsApproval = irreversibleVerbs.some((verb) => lower.includes(verb)) || lower.includes("login") || lower.includes("log in") || lower.includes("sign in") || lower.includes("authenticate");
  const isBrowserTask = browserVerbs.some((verb) => lower.includes(verb)) || authVerbs.some((verb) => lower.includes(verb)) || Boolean(action);

  if (action) {
    return {
      id: createId(`step_${index}`),
      kind: action.type === "login" ? "auth" : "browser",
      title: clause,
      details: `Browser action derived from: ${clause}`,
      tool: "browser",
      retryLimit: 3,
      requiresApproval: needsApproval,
      ...(needsApproval ? { approvalReason: "Login or irreversible action requires confirmation before execution." } : {}),
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
      approvalReason: "This step may change account state or submit a final action.",
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
  const normalizedContext = normalizeGoalContext(request.context);
  const clauses = splitGoal(request.goal);
  const browserHeavy = clauses.some((clause) => browserVerbs.some((verb) => clause.toLowerCase().includes(verb)));
  const wantsSearch = hasIntent(request.goal, searchVerbs);
  const wantsSave = hasIntent(request.goal, saveVerbs);
  const steps: PlanStep[] = [];

  steps.push({
    id: createId("step_0"),
    kind: "analysis",
    title: "Clarify objective and constraints",
    details: normalizedContext ? `Use provided context and inputs. Context: ${normalizedContext.summary}` : "Derive the task shape and identify required inputs.",
    tool: "planner",
    retryLimit: 0,
    metadata: { inputs: request.inputs ?? {}, context: normalizedContext?.structured ?? {} },
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

  if (browserHeavy || wantsSearch || wantsSave) {
    steps.push({
      id: createId("step_search"),
      kind: "browser",
      title: "Locate relevant source pages",
      details: "Open a search results page or known target source to find the information needed to complete the goal.",
      tool: "browser",
      retryLimit: 2,
      browserAction: {
        type: "goto",
        url: buildSearchUrl(`${request.goal} ${normalizedContext?.summary ?? ""}`.trim()),
      },
      metadata: { source: "deterministic-search" },
    });
  }

  clauses.forEach((clause, index) => {
    steps.push(stepFromClause(clause, index + 1));
  });

  if (wantsSave || /spreadsheet|sheet|csv|table|report|compare/i.test(request.goal)) {
    steps.push({
      id: createId("step_result"),
      kind: "data",
      title: "Summarize and save results",
      details: "Consolidate the collected data into a reviewable summary, spreadsheet-friendly structure, or exportable result.",
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
