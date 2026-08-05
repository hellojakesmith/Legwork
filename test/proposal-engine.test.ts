import { describe, expect, it } from "vitest";
import { generateProposals } from "../src/improvement/proposal-engine.js";

describe("generateProposals", () => {
  it("generates improvement proposals from metrics", () => {
    const proposals = generateProposals({
      totalRuns: 4,
      completedRuns: 1,
      failedRuns: 2,
      waitingForApprovalRuns: 1,
      averageRetries: 1.5,
      topFailureMessages: [{ message: "timeout", count: 3 }],
      browserErrorCount: 2,
    });

    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some((proposal) => proposal.title.includes("browser recovery"))).toBe(true);
  });
});
