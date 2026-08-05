import { describe, expect, it } from "vitest";
import { CredentialVault } from "../src/runtime/credential-vault.js";

describe("CredentialVault", () => {
  it("stores sessions only in memory and supports deletion", () => {
    const vault = new CredentialVault();
    const session = vault.create({
      label: "portal",
      credentials: {
        username: "user@example.com",
        password: "secret",
      },
      ttlMs: 60_000,
    });

    expect(vault.get(session.id)?.credentials.username).toBe("user@example.com");
    expect(vault.list()).toHaveLength(1);
    expect(vault.delete(session.id)).toBe(true);
    expect(vault.get(session.id)).toBeUndefined();
  });
});
