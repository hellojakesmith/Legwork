import { resolve } from "node:path";

export const repoRoot = process.cwd();
export const legworkDir = resolve(repoRoot, ".legwork");
export const runsDir = resolve(legworkDir, "runs");
export const workflowsDir = resolve(legworkDir, "workflows");
export const proposalsDir = resolve(legworkDir, "proposals");
export const browserArtifactsDir = resolve(legworkDir, "artifacts");
