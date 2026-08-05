import type { RunRecord } from "../core/types.js";
import type { ObservationSummary } from "../core/types.js";

export function summarizeRuns(runs: RunRecord[]): ObservationSummary {
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const waitingForApprovalRuns = runs.filter((run) => run.status === "waiting_for_approval").length;
  const retryCounts = runs.flatMap((run) =>
    run.events.filter((event) => event.type === "run.step.failed").map((event) => Number(event.data?.attempt ?? 0)),
  );
  const failureMessages = new Map<string, number>();
  let browserErrorCount = 0;

  for (const run of runs) {
    for (const event of run.events) {
      if (event.type === "run.step.failed" || event.type === "run.failed") {
        failureMessages.set(event.message, (failureMessages.get(event.message) ?? 0) + 1);
      }
      if (event.type === "browser.error") {
        browserErrorCount += 1;
      }
    }
  }

  return {
    totalRuns: runs.length,
    completedRuns,
    failedRuns,
    waitingForApprovalRuns,
    averageRetries: retryCounts.length ? retryCounts.reduce((sum, value) => sum + value, 0) / retryCounts.length : 0,
    topFailureMessages: [...failureMessages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count })),
    browserErrorCount,
  };
}
