export type StepKind = "analysis" | "browser" | "approval" | "data" | "checkpoint";

export interface GoalRequest {
  goal: string;
  context?: string;
  inputs?: Record<string, unknown>;
}

export interface BrowserActionSpec {
  type: "goto" | "click" | "fill" | "type" | "extract" | "screenshot";
  url?: string;
  selector?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  path?: string;
  timeoutMs?: number;
}

export interface PlanStep {
  id: string;
  kind: StepKind;
  title: string;
  details: string;
  tool: "planner" | "browser" | "human" | "analysis" | "workflow";
  requiresApproval?: boolean;
  retryLimit?: number;
  browserAction?: BrowserActionSpec;
  metadata?: Record<string, unknown>;
}

export interface TaskPlan {
  id: string;
  goal: string;
  summary: string;
  createdAt: string;
  steps: PlanStep[];
  assumptions: string[];
}

export type RunStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "canceled";

export interface RunEvent {
  id: string;
  at: string;
  type:
    | "run.started"
    | "run.step.started"
    | "run.step.completed"
    | "run.step.failed"
    | "run.approval.required"
    | "run.approval.granted"
    | "run.completed"
    | "run.failed"
    | "browser.action"
    | "browser.error"
    | "workflow.saved";
  message: string;
  stepId?: string;
  data?: Record<string, unknown>;
}

export interface RunCheckpoint {
  stepIndex: number;
  awaitingApprovalForStepId?: string;
  approvedStepId?: string;
}

export interface RunRecord {
  id: string;
  goal: string;
  planId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  checkpoint: RunCheckpoint;
  outputs: Array<{ label: string; value: unknown }>;
  events: RunEvent[];
  planSnapshot: TaskPlan;
  error?: string;
  workflowId?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceRunId: string;
  plan: TaskPlan;
  inputsSchema: Record<string, unknown>;
  outputsSchema: Record<string, unknown>;
}

export interface ImprovementAgentDefinition {
  id: string;
  title: string;
  mission: string;
  permissions: string[];
  outputs: string[];
}

export interface ObservationSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  waitingForApprovalRuns: number;
  averageRetries: number;
  topFailureMessages: Array<{ message: string; count: number }>;
  browserErrorCount: number;
}

export interface ImprovementProposal {
  id: string;
  createdAt: string;
  title: string;
  problem: string;
  expectedImpact: string;
  evidence: string[];
  targetAgent: string;
  implementationNotes: string[];
}
