import { expect, it, vi } from "vitest";
import { AuthService } from "./service";
import { hash, sessionLifetimeSeconds } from "./tokens";
import type { AuthStore } from "./store";
import type { IdentityProvider } from "./google";
import { LocalCredentialCipher } from "./encryption";
function dependencies() {
  const store: AuthStore = {
    saveAttempt: vi.fn<AuthStore["saveAttempt"]>(async () => {}),
    consumeAttempt: vi.fn<AuthStore["consumeAttempt"]>(async () => null),
    saveSession: vi.fn<AuthStore["saveSession"]>(async () => {}),
    validateSession: vi.fn<AuthStore["validateSession"]>(async () => null),
    deleteSession: vi.fn<AuthStore["deleteSession"]>(async () => {}),
    saveProfile: vi.fn<AuthStore["saveProfile"]>(async () => {}),
    getProfile: vi.fn<AuthStore["getProfile"]>(async () => null),
  };
  const provider: IdentityProvider = {
    authorization: vi.fn<IdentityProvider["authorization"]>(async () => ({
      url: "https://accounts.google.com/example",
      verifier: "verifier",
    })),
    exchange: vi.fn<IdentityProvider["exchange"]>(async () => ({
      subject: "123",
      email: "user@example.test",
      name: "User",
    })),
  };
  return { store, provider };
}
it("stores only hashes of session and browser-binding tokens", async () => {
  const { store, provider } = dependencies();
  const now = new Date("2026-09-28T12:00:00Z");
  const service = new AuthService(store, provider, () => now);
  const started = await service.start();
  expect(store.saveAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      bindingHash: hash(started.binding),
      expiresAt: Math.floor(now.getTime() / 1000) + 600,
    }),
  );
  vi.mocked(store.consumeAttempt).mockResolvedValue({
    stateHash: "state",
    bindingHash: "binding",
    nonce: "nonce",
    verifier: "verifier",
    expiresAt: 9999999999,
  });
  const session = await service.complete("code", "state", started.binding);
  expect(session.token).toHaveLength(43);
  expect(store.saveSession).toHaveBeenCalledWith(
    expect.objectContaining({
      tokenHash: hash(session.token),
      expiresAt: Math.floor(now.getTime() / 1000) + sessionLifetimeSeconds,
    }),
  );
});
it("rejects consumed, expired or browser-mismatched attempts before exchanging a code", async () => {
  const { store, provider } = dependencies();
  const service = new AuthService(store, provider);
  await expect(service.complete("code", "state", "wrong-browser")).rejects.toThrow(
    "Sign-in could not be completed",
  );
  expect(provider.exchange).not.toHaveBeenCalled();
});
it("does not accept malformed session tokens or invent a profile", async () => {
  const { store, provider } = dependencies();
  const service = new AuthService(store, provider);
  expect(await service.authenticate("bad", true)).toBeNull();
  expect(store.validateSession).not.toHaveBeenCalled();
});
it("encrypts credentials with a random nonce and binds them to the owning account", async () => {
  const cipher = new LocalCredentialCipher(Buffer.alloc(32, 1).toString("base64"));
  const a = await cipher.encrypt("secret", "user/account");
  const b = await cipher.encrypt("secret", "user/account");
  expect(a).not.toBe(b);
  expect(a).not.toContain("secret");
  expect(await cipher.decrypt(a, "user/account")).toBe("secret");
  await expect(cipher.decrypt(a, "other/account")).rejects.toThrow(
    /authenticate|Unsupported state/i,
  );
});
