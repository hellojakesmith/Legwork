import type { BrowserAgent } from "../browser/browser-agent.js";
import { CredentialVault } from "./credential-vault.js";

export class SessionRegistry {
  private readonly browserSessions = new Map<string, BrowserAgent>();
  private readonly runCredentialSessions = new Map<string, string>();

  constructor(public readonly credentialVault = new CredentialVault()) {}

  setBrowserSession(runId: string, browserAgent: BrowserAgent): void {
    this.browserSessions.set(runId, browserAgent);
  }

  takeBrowserSession(runId: string): BrowserAgent | undefined {
    const browserAgent = this.browserSessions.get(runId);
    if (browserAgent) {
      this.browserSessions.delete(runId);
    }
    return browserAgent;
  }

  peekBrowserSession(runId: string): BrowserAgent | undefined {
    return this.browserSessions.get(runId);
  }

  clearBrowserSession(runId: string): void {
    this.browserSessions.delete(runId);
  }

  setRunCredentialSession(runId: string, credentialSessionId: string): void {
    this.runCredentialSessions.set(runId, credentialSessionId);
  }

  getRunCredentialSession(runId: string): string | undefined {
    return this.runCredentialSessions.get(runId);
  }

  clearRunCredentialSession(runId: string): void {
    this.runCredentialSessions.delete(runId);
  }
}
