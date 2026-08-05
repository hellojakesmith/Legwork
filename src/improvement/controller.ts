import { join } from "node:path";
import { internalAgents } from "./agents.js";
import { summarizeRuns } from "./observation-hub.js";
import { generateProposals } from "./proposal-engine.js";
import { BranchService } from "./branch-service.js";
import { PullRequestService } from "./pr-service.js";
import type { RunRecord } from "../core/types.js";
import { proposalsDir } from "../shared/config.js";
import { writeJson } from "../shared/fs.js";
import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";

export interface ImprovementCycleResult {
  summary: ReturnType<typeof summarizeRuns>;
  proposals: ReturnType<typeof generateProposals>;
}

export class ImprovementController {
  constructor(
    private readonly branchService = new BranchService(),
    private readonly prService = new PullRequestService(),
  ) {}

  agents() {
    return internalAgents;
  }

  async analyze(runs: RunRecord[]): Promise<ImprovementCycleResult> {
    const summary = summarizeRuns(runs);
    const proposals = generateProposals(summary);
    for (const proposal of proposals) {
      await writeJson(join(proposalsDir, `${proposal.id}.json`), proposal);
    }
    return { summary, proposals };
  }

  async prepareImplementationBranch(proposalTitle: string): Promise<{ branchName: string }> {
    const branchName = `codex/${proposalTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}-${createId("improve").slice(-8)}`;
    await this.branchService.createBranch(branchName);
    return { branchName };
  }

  async openDraftPullRequest(branchName: string, title: string, body: string): Promise<{ url: string }> {
    if (!(await this.branchService.canUseGh())) {
      throw new Error("GitHub CLI (gh) is not available for PR creation");
    }
    return this.prService.open({
      title,
      body,
      branchName,
      draft: true,
    });
  }

  implementationTemplate(proposalTitle: string, summary: string): string {
    return [
      `# ${proposalTitle}`,
      "",
      `Created: ${nowIso()}`,
      "",
      "## Context",
      summary,
      "",
      "## Notes",
      "- Implement on a feature branch only.",
      "- Run tests before opening a PR.",
      "- Do not merge to main or deploy.",
    ].join("\n");
  }
}
