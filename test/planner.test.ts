import { describe, expect, it } from "vitest";
import { planGoal } from "../src/core/planner.js";

describe("planGoal", () => {
  it("creates browser steps and approval gates for irreversible work", () => {
    const plan = planGoal({
      goal: "Compare business insurance from five providers, fill out applications, and submit them for approval.",
    });

    expect(plan.steps.length).toBeGreaterThan(3);
    expect(plan.steps.some((step) => step.kind === "browser")).toBe(true);
    expect(plan.steps.some((step) => step.requiresApproval)).toBe(true);
  });
});
