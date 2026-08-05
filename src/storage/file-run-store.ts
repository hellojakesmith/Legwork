import { join } from "node:path";
import { runsDir } from "../shared/config.js";
import { readJson, writeJson } from "../shared/fs.js";
import type { RunRecord } from "../core/types.js";
import type { RunStorage } from "../core/execution-engine.js";

export class FileRunStore implements RunStorage {
  constructor(private readonly baseDir = runsDir) {}

  private filePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  async save(run: RunRecord): Promise<void> {
    await writeJson(this.filePath(run.id), run);
  }

  async load(id: string): Promise<RunRecord | undefined> {
    const run = await readJson<RunRecord | undefined>(this.filePath(id), undefined);
    return run;
  }

  async list(): Promise<RunRecord[]> {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(this.baseDir).catch(() => []);
    const runs = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => readJson<RunRecord | undefined>(join(this.baseDir, file), undefined)),
    );
    return runs.filter((run): run is RunRecord => Boolean(run));
  }
}
