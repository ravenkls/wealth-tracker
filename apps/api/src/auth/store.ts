import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { authEntities } from "../storage/entities";
import type { Profile } from "../storage/entities";
import { hasErrorName } from "../storage/errors";
import { sessionLifetimeSeconds } from "./tokens";

export interface OAuthAttempt {
  stateHash: string;
  bindingHash: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}
export interface Session {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  createdAt: string;
}
export interface AuthStore {
  saveAttempt(attempt: OAuthAttempt): Promise<void>;
  consumeAttempt(stateHash: string, bindingHash: string, now: number): Promise<OAuthAttempt | null>;
  saveSession(session: Session): Promise<void>;
  validateSession(tokenHash: string, now: number, renew: boolean): Promise<Session | null>;
  deleteSession(tokenHash: string): Promise<void>;
  saveProfile(userId: string, profile: Profile, now: Date): Promise<void>;
  getProfile(userId: string): Promise<Profile | null>;
}
export class DynamoAuthStore implements AuthStore {
  private readonly entities: ReturnType<typeof authEntities>;
  constructor(client: DynamoDBDocumentClient, table: string) {
    this.entities = authEntities(client, table);
  }
  async saveAttempt(attempt: OAuthAttempt) {
    await this.entities.attempts.create(attempt).go();
  }
  async consumeAttempt(stateHash: string, bindingHash: string, now: number) {
    try {
      const result = await this.entities.attempts
        .delete({ stateHash })
        .where((a, o) => `${o.eq(a.bindingHash, bindingHash)} AND ${o.gt(a.expiresAt, now)}`)
        .go({ response: "all_old" });
      return result.data;
    } catch (error) {
      if (hasErrorName(error, "ConditionalCheckFailedException")) return null;
      throw error;
    }
  }
  async saveSession(session: Session) {
    await this.entities.sessions.create(session).go();
  }
  async validateSession(tokenHash: string, now: number, renew: boolean): Promise<Session | null> {
    if (renew) {
      const expiresAt = now + sessionLifetimeSeconds;
      try {
        const result = await this.entities.sessions
          .patch({ tokenHash })
          .set({ expiresAt })
          .where((a, o) => `${o.gt(a.expiresAt, now)} AND ${o.lt(a.expiresAt, expiresAt)}`)
          .go({ response: "all_new" });
        return result.data;
      } catch (error) {
        if (!hasErrorName(error, "ConditionalCheckFailedException")) throw error;
      }
    }
    const result = await this.entities.sessions.get({ tokenHash }).go({ consistent: true });
    return result.data && result.data.expiresAt > now ? result.data : null;
  }
  async deleteSession(tokenHash: string) {
    await this.entities.sessions.delete({ tokenHash }).go();
  }
  async saveProfile(userId: string, profile: Profile, now: Date) {
    await this.entities.profiles
      .upsert({
        owner: userId,
        id: "profile",
        data: profile,
        version: 1,
        updatedAt: now.toISOString(),
      })
      .ifNotExists({ createdAt: now.toISOString() })
      .go();
  }
  async getProfile(userId: string) {
    return (
      (await this.entities.profiles.get({ owner: userId, id: "profile" }).go({ consistent: true }))
        .data?.data ?? null
    );
  }
}
