import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { leadSearchesDir } from "../shared/config.js";
import { readJson, writeJson } from "../shared/fs.js";
import type { LeadSearchRecord, LeadStatus } from "../leads/types.js";

export class LeadSearchStore {
  constructor(private readonly baseDir = leadSearchesDir) {}

  private filePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  async save(record: LeadSearchRecord): Promise<void> {
    await writeJson(this.filePath(record.id), record);
  }

  async load(id: string): Promise<LeadSearchRecord | undefined> {
    return readJson<LeadSearchRecord | undefined>(this.filePath(id), undefined);
  }

  async list(): Promise<LeadSearchRecord[]> {
    const files = await readdir(this.baseDir).catch(() => []);
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => readJson<LeadSearchRecord | undefined>(join(this.baseDir, file), undefined)),
    );
    return records.filter((record): record is LeadSearchRecord => Boolean(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateLeadStatus(searchId: string, leadId: string, status: LeadStatus): Promise<LeadSearchRecord | undefined> {
    const record = await this.load(searchId);
    if (!record) {
      return undefined;
    }
    record.results = record.results.map((lead) => (lead.id === leadId ? { ...lead, status } : lead));
    record.updatedAt = new Date().toISOString();
    await this.save(record);
    return record;
  }

  async markSaved(searchId: string, workflowId: string): Promise<LeadSearchRecord | undefined> {
    const record = await this.load(searchId);
    if (!record) {
      return undefined;
    }
    record.savedWorkflowId = workflowId;
    record.updatedAt = new Date().toISOString();
    await this.save(record);
    return record;
  }
}
