import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import type { ImprovementProposal, ObservationSummary } from "../core/types.js";

export function generateProposals(summary: ObservationSummary): ImprovementProposal[] {
  const proposals: ImprovementProposal[] = [];

  if (summary.browserErrorCount > 0 || summary.averageRetries >= 1) {
    proposals.push({
      id: createId("proposal"),
      createdAt: nowIso(),
      title: "Strengthen browser recovery paths",
      problem: "Browser tasks are experiencing retries or page-level errors.",
      expectedImpact: "Fewer failed runs, fewer human interventions, and more resilient navigation across dynamic pages.",
      evidence: [
        `Average retries: ${summary.averageRetries.toFixed(2)}`,
        `Browser errors observed: ${summary.browserErrorCount}`,
      ],
      targetAgent: "engineer",
      implementationNotes: [
        "Add more fallback locators and selector heuristics.",
        "Capture state snapshots after transient failures.",
        "Tighten retry/backoff policy for page changes.",
      ],
    });
  }

  if (summary.waitingForApprovalRuns > 0) {
    proposals.push({
      id: createId("proposal"),
      createdAt: nowIso(),
      title: "Reduce approval friction with better gating metadata",
      problem: "Runs are pausing for approval without enough context for quick decisions.",
      expectedImpact: "Faster approval decisions and fewer stalled runs.",
      evidence: [`Approval-paused runs: ${summary.waitingForApprovalRuns}`],
      targetAgent: "manager",
      implementationNotes: [
        "Include the exact irreversible action in approval prompts.",
        "Attach downstream impact summary to the checkpoint record.",
      ],
    });
  }

  if (summary.failedRuns > 0) {
    proposals.push({
      id: createId("proposal"),
      createdAt: nowIso(),
      title: "Expand run diagnostics and failure clustering",
      problem: "Repeated failures are not yet grouped into actionable categories.",
      expectedImpact: "More targeted fixes and faster root cause analysis.",
      evidence: summary.topFailureMessages.map((item) => `${item.count}x ${item.message}`),
      targetAgent: "performance-analyst",
      implementationNotes: [
        "Cluster failures by step kind and browser error signature.",
        "Persist a compact incident summary next to each run.",
      ],
    });
  }

  return proposals;
}
