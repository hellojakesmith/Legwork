import type { GoalContext } from "./types.js";

export interface NormalizedGoalContext {
  summary: string;
  structured: GoalContext;
}

function stringifyObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item)) {
      return `${key}: ${item.join(", ")}`;
    }
    if (item && typeof item === "object") {
      return `${key}: ${JSON.stringify(item)}`;
    }
    return `${key}: ${String(item)}`;
  });
  return entries.join("; ");
}

export function normalizeGoalContext(context?: string | GoalContext): NormalizedGoalContext | undefined {
  if (!context) {
    return undefined;
  }

  if (typeof context === "string") {
    return {
      summary: context.trim(),
      structured: { summary: context.trim() },
    };
  }

  const parts: string[] = [];

  if (context.summary) parts.push(context.summary);
  if (context.resumeText) parts.push(`Resume: ${context.resumeText}`);
  if (context.profileLinks?.length) parts.push(`Profile links: ${context.profileLinks.join(", ")}`);
  if (context.preferences && Object.keys(context.preferences).length > 0) {
    parts.push(`Preferences: ${stringifyObject(context.preferences)}`);
  }
  if (context.constraints?.length) parts.push(`Constraints: ${context.constraints.join(", ")}`);
  if (context.accountHints?.length) parts.push(`Account hints: ${context.accountHints.join(", ")}`);
  if (context.runtimeNotes) parts.push(`Runtime notes: ${context.runtimeNotes}`);
  if (context.attachments?.length) {
    for (const attachment of context.attachments) {
      parts.push(`${attachment.name} (${attachment.kind})`);
    }
  }

  return {
    summary: parts.join("\n").trim(),
    structured: context,
  };
}
