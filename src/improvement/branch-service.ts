import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`]);
    return true;
  } catch {
    return false;
  }
}

export class BranchService {
  async createBranch(branchName: string): Promise<void> {
    await execFileAsync("git", ["checkout", "-b", branchName]);
  }

  async currentBranch(): Promise<string> {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"]);
    return stdout.trim();
  }

  async push(branchName: string): Promise<void> {
    await execFileAsync("git", ["push", "-u", "origin", branchName]);
  }

  async canUseGh(): Promise<boolean> {
    return commandExists("gh");
  }
}
