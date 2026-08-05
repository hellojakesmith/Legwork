import type { RuntimeCredentials, RunEvent } from "../core/types.js";

export interface BrowserChallenge {
  type: "login-wall" | "captcha" | "2fa" | "unexpected-auth" | "rate-limit" | "unknown";
  message: string;
}

export class BrowserChallengeError extends Error {
  constructor(public readonly challenge: BrowserChallenge) {
    super(challenge.message);
    this.name = "BrowserChallengeError";
  }
}

export interface BrowserActionContext {
  runId: string;
  stepId: string;
  emit: (event: RunEvent) => void;
  credentialSessionId?: string;
  resolveCredentials?: (credentialSessionId: string) => Promise<RuntimeCredentials | undefined>;
}

export interface BrowserAgent {
  open(url: string, context: BrowserActionContext): Promise<void>;
  click(spec: { selector?: string; role?: string; name?: string }, context: BrowserActionContext): Promise<void>;
  fill(spec: { selector?: string; label?: string; placeholder?: string; text: string }, context: BrowserActionContext): Promise<void>;
  type(spec: { selector?: string; text: string }, context: BrowserActionContext): Promise<void>;
  select(spec: { selector?: string; label?: string; value: string | string[] }, context: BrowserActionContext): Promise<void>;
  check(spec: { selector?: string; label?: string }, context: BrowserActionContext): Promise<void>;
  uncheck(spec: { selector?: string; label?: string }, context: BrowserActionContext): Promise<void>;
  upload(spec: { selector?: string; filePath: string }, context: BrowserActionContext): Promise<void>;
  login(spec: { submitSelector?: string }, context: BrowserActionContext): Promise<void>;
  wait(spec: { selector?: string; timeoutMs?: number; ms?: number }, context: BrowserActionContext): Promise<void>;
  extractText(spec: { selector?: string }, context: BrowserActionContext): Promise<string>;
  extractStructured(spec: { selector?: string }, context: BrowserActionContext): Promise<unknown>;
  screenshot(spec: { path?: string }, context: BrowserActionContext): Promise<string>;
  detectChallenge(): Promise<BrowserChallenge | undefined>;
  close(): Promise<void>;
}
