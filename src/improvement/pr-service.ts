import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PullRequestRequest {
  title: string;
  body: string;
  branchName: string;
  draft?: boolean;
}

export class PullRequestService {
  async open(request: PullRequestRequest): Promise<{ url: string }> {
    const args = ["pr", "create", "--title", request.title, "--body", request.body, "--head", request.branchName];
    if (request.draft) {
      args.unshift("--draft");
    }
    const { stdout } = await execFileAsync("gh", args);
    return { url: stdout.trim() };
  }
}
