import type { AuthStore } from "./store";
import type { IdentityProvider } from "./google";
import { hash, sessionLifetimeSeconds, token } from "./tokens";
export class AuthenticationError extends Error {
  constructor() {
    super("Sign-in could not be completed. Please try again.");
    this.name = "AuthenticationError";
  }
}
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly provider: IdentityProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async start() {
    const state = token(),
      binding = token(),
      nonce = token();
    const auth = await this.provider.authorization(state, nonce);
    await this.store.saveAttempt({
      stateHash: hash(state),
      bindingHash: hash(binding),
      nonce,
      verifier: auth.verifier,
      expiresAt: Math.floor(this.now().getTime() / 1000) + 600,
    });
    return { url: auth.url, binding };
  }
  async complete(code: string, state: string, binding: string) {
    const now = this.now();
    const attempt = await this.store.consumeAttempt(
      hash(state),
      hash(binding),
      Math.floor(now.getTime() / 1000),
    );
    if (!attempt) throw new AuthenticationError();
    const identity = await this.provider.exchange(code, attempt.verifier, attempt.nonce);
    const userId = hash(`google:${identity.subject}`);
    await this.store.saveProfile(userId, { name: identity.name, email: identity.email }, now);
    const sessionToken = token();
    const expiresAt = Math.floor(now.getTime() / 1000) + sessionLifetimeSeconds;
    await this.store.saveSession({
      tokenHash: hash(sessionToken),
      userId,
      expiresAt,
      createdAt: now.toISOString(),
    });
    return { token: sessionToken, expiresAt };
  }
  async authenticate(sessionToken: string | undefined, renew: boolean) {
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;
    const session = await this.store.validateSession(
      hash(sessionToken),
      Math.floor(this.now().getTime() / 1000),
      renew,
    );
    if (!session) return null;
    const profile = await this.store.getProfile(session.userId);
    return profile ? { userId: session.userId, profile, expiresAt: session.expiresAt } : null;
  }
  async logout(sessionToken: string | undefined) {
    if (sessionToken) await this.store.deleteSession(hash(sessionToken));
  }
}
