import type { RunEvent } from "../core/types.js";

export interface BrowserActionContext {
  runId: string;
  stepId: string;
  emit: (event: RunEvent) => void;
}

export interface BrowserAgent {
  open(url: string, context: BrowserActionContext): Promise<void>;
  click(spec: { selector?: string; role?: string; name?: string }, context: BrowserActionContext): Promise<void>;
  fill(spec: { selector?: string; label?: string; placeholder?: string; text: string }, context: BrowserActionContext): Promise<void>;
  type(spec: { selector?: string; text: string }, context: BrowserActionContext): Promise<void>;
  extractText(spec: { selector?: string }, context: BrowserActionContext): Promise<string>;
  screenshot(spec: { path?: string }, context: BrowserActionContext): Promise<string>;
  close(): Promise<void>;
}
