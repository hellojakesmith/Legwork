import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LeadSearchStore } from "../src/storage/lead-search-store.js";
import type { LeadSearchRecord } from "../src/leads/types.js";

describe("LeadSearchStore", () => {
  it("saves, loads, and updates lead search records", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "legwork-leads-"));
    const store = new LeadSearchStore(baseDir);
    const record: LeadSearchRecord = {
      id: "lead_search_test",
      mode: "freelance",
      title: "Find Freelance Work",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      criteria: {
        objective: "Find Node.js projects",
        keywords: ["Node.js"],
        skills: ["Node.js"],
        platforms: ["freelancer"],
        budgetType: "both",
        preferredTechnologies: ["Node.js"],
        projectTypes: ["Automation"],
        remotePreference: "remote",
        maxLeads: 5,
      },
      planSnapshot: {
        id: "plan-1",
        goal: "Find Node.js projects",
        summary: "Plan summary",
        createdAt: new Date().toISOString(),
        steps: [],
        assumptions: [],
      },
      events: [],
      results: [],
      summary: "Working...",
    };

    await store.save(record);
    const loaded = await store.load(record.id);
    expect(loaded?.title).toBe("Find Freelance Work");

    const updated = await store.updateLeadStatus(record.id, "lead-1", "saved");
    expect(updated?.results).toEqual([]);
  });
});
