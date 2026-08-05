import type { ImprovementAgentDefinition } from "../core/types.js";

export const internalAgents: ImprovementAgentDefinition[] = [
  {
    id: "manager",
    title: "Manager",
    mission: "Own prioritization, decide which observations become proposals, and ensure improvements target measurable user value.",
    permissions: ["observe", "prioritize", "propose", "branch", "pr"],
    outputs: ["prioritized backlog", "cycle summary"],
  },
  {
    id: "performance-analyst",
    title: "Performance Analyst",
    mission: "Identify latency, retry, and approval bottlenecks from run history.",
    permissions: ["read-runs", "analyze-metrics", "propose"],
    outputs: ["metric summary", "bottleneck analysis"],
  },
  {
    id: "architect",
    title: "Architect",
    mission: "Evaluate structural changes, boundaries, and failure modes before implementation.",
    permissions: ["read-code", "design-change", "propose"],
    outputs: ["design review", "module plan"],
  },
  {
    id: "engineer",
    title: "Engineer",
    mission: "Create branches, write code, and run tests for approved proposals.",
    permissions: ["write-code", "run-tests", "branch", "pr"],
    outputs: ["implementation branch", "test results"],
  },
  {
    id: "qa",
    title: "QA",
    mission: "Verify run behavior, regression risk, and acceptance criteria.",
    permissions: ["run-tests", "inspect-history", "report"],
    outputs: ["verification summary"],
  },
  {
    id: "security",
    title: "Security",
    mission: "Review sensitive changes, credentials handling, browser automation risks, and PR boundary enforcement.",
    permissions: ["review-code", "flag-risk", "propose"],
    outputs: ["security review"],
  },
];
