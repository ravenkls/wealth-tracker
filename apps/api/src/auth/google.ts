import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import type { Profile } from "../storage/entities";
export interface GoogleIdentity extends Profile {
  readonly subject: string;
}
export interface IdentityProvider {
  authorization(state: string, nonce: string): Promise<{ url: string; verifier: string }>;
  exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity>;
}
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly client: OAuth2Client;
  constructor(
    private readonly clientId: string,
    clientSecret: string,
    private readonly redirectUri: string,
  ) {
    this.client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  }
  async authorization(state: string, nonce: string) {
    const pkce = await this.client.generateCodeVerifierAsync();
    if (!pkce.codeChallenge) throw new Error("PKCE challenge could not be created.");
    return {
      url: this.client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        redirect_uri: this.redirectUri,
      }),
      verifier: pkce.codeVerifier,
    };
  }
  async exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
    const result = await this.client.getToken({
      code,
      codeVerifier: verifier,
      redirect_uri: this.redirectUri,
    });
    if (!result.tokens.id_token) throw new Error("Google did not return an identity token.");
    const ticket = await this.client.verifyIdToken({
      idToken: result.tokens.id_token,
      audience: this.clientId,
    });
    const claims = ticket.getPayload();
    if (
      !claims?.sub ||
      !claims.email ||
      !claims.email_verified ||
      !("nonce" in claims) ||
      claims.nonce !== nonce
    )
      throw new Error("Google identity verification failed.");
    return { subject: claims.sub, email: claims.email, name: claims.name || claims.email };
  }
}
