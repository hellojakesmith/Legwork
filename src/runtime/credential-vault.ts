import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import type { RuntimeCredentialSession, RuntimeCredentials } from "../core/types.js";

export interface CreateCredentialSessionRequest {
  label?: string;
  credentials: RuntimeCredentials;
  ttlMs?: number;
}

export class CredentialVault {
  private readonly sessions = new Map<string, RuntimeCredentialSession>();

  create(request: CreateCredentialSessionRequest): RuntimeCredentialSession {
    const createdAt = nowIso();
    const ttlMs = request.ttlMs ?? 1000 * 60 * 60 * 4;
    const id = createId("cred");
    const session: RuntimeCredentialSession = {
      id,
      createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      credentials: request.credentials,
      ...(request.label ? { label: request.label } : {}),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): RuntimeCredentialSession | undefined {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return structuredClone(session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  list(): RuntimeCredentialSession[] {
    return [...this.sessions.values()]
      .filter((session) => Date.parse(session.expiresAt) > Date.now())
      .map((session) => structuredClone(session));
  }

  clearExpired(): void {
    for (const [id, session] of this.sessions.entries()) {
      if (Date.parse(session.expiresAt) <= Date.now()) {
        this.sessions.delete(id);
      }
    }
  }
}
