import { z } from "zod";
import { pence, type Pence } from "@wealth/domain";

const apiOrigin = "https://api.monzo.com";
const identifier = z.string().min(1).max(200);
const amount = z.number().int().safe();
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.literal("Bearer"),
  user_id: identifier,
});
const accountsSchema = z.object({
  accounts: z.array(
    z.object({
      id: identifier,
      description: z.string(),
      type: z.string().optional(),
      closed: z.boolean().optional(),
    }),
  ),
});
const balanceSchema = z.object({
  balance: amount,
  total_balance: amount.optional(),
  currency: z.literal("GBP"),
});
const potsSchema = z.object({
  pots: z.array(
    z.object({
      id: identifier,
      name: z.string(),
      balance: amount,
      currency: z.string(),
      deleted: z.boolean(),
    }),
  ),
});

export interface MonzoClientCredentials {
  clientId: string;
  clientSecret: string;
}
export interface MonzoTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}
export interface MonzoBalance {
  id: string;
  parentAccountId: string;
  name: string;
  type: "account" | "pot";
  kind?: "cash" | "debt";
  balance: Pence;
}
export interface MonzoValuation {
  balances: MonzoBalance[];
  fetchedAt: string;
}
export class MonzoError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "unauthorized" | "approval" | "rate-limit" = "unavailable",
  ) {
    super(message);
    this.name = "MonzoError";
  }
}
export interface MonzoProvider {
  authorizeUrl(clientId: string, redirectUri: string, state: string): string;
  exchange(
    credentials: MonzoClientCredentials,
    code: string,
    redirectUri: string,
  ): Promise<MonzoTokens>;
  refresh(credentials: MonzoClientCredentials, refreshToken: string): Promise<MonzoTokens>;
  value(accessToken: string): Promise<MonzoValuation>;
  revoke(accessToken: string): Promise<void>;
}

export class MonzoClient implements MonzoProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorizeUrl(clientId: string, redirectUri: string, state: string) {
    const url = new URL("https://auth.monzo.com/");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    }).toString();
    return url.toString();
  }
  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, apiOrigin), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new MonzoError("Monzo could not be reached. Try again.");
    }
    if (response.status === 401)
      throw new MonzoError(
        "Monzo access has expired or been revoked. Reconnect your account.",
        "unauthorized",
      );
    if (response.status === 403)
      throw new MonzoError(
        "Approve access in the Monzo app, then retry. If already approved, reconnect your account.",
        "approval",
      );
    if (response.status === 429)
      throw new MonzoError("Monzo is rate limiting requests. Wait before retrying.", "rate-limit");
    if (!response.ok)
      throw new MonzoError(
        "Monzo could not complete this request. Check your client settings or try again.",
      );
    if (response.status === 204) return {};
    try {
      return await response.json();
    } catch {
      throw new MonzoError("Monzo returned an invalid response.");
    }
  }
  private async tokens(
    credentials: MonzoClientCredentials,
    grant: Record<string, string>,
  ): Promise<MonzoTokens> {
    const result = tokenSchema.safeParse(
      await this.request("/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          ...grant,
        }),
      }),
    );
    if (!result.success)
      throw new MonzoError(
        "Monzo did not return renewable access. Use a confidential OAuth client and reconnect.",
      );
    return {
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token,
      expiresAt: new Date(this.now().getTime() + result.data.expires_in * 1000).toISOString(),
      userId: result.data.user_id,
    };
  }
  exchange(credentials: MonzoClientCredentials, code: string, redirectUri: string) {
    return this.tokens(credentials, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
  }
  refresh(credentials: MonzoClientCredentials, refreshToken: string) {
    return this.tokens(credentials, { grant_type: "refresh_token", refresh_token: refreshToken });
  }
  private get(path: string, accessToken: string) {
    return this.request(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  }
  async value(accessToken: string): Promise<MonzoValuation> {
    const result = accountsSchema.safeParse(await this.get("/accounts", accessToken));
    if (!result.success) throw new MonzoError("Monzo returned incomplete account data.");
    const balances: MonzoBalance[] = [];
    const seen = new Set<string>();
    await Promise.all(
      result.data.accounts
        .filter(
          (account) =>
            !account.closed &&
            (!account.type ||
              ["uk_retail", "uk_retail_joint", "uk_business", "uk_monzo_flex"].includes(
                account.type,
              )),
        )
        .map(async (account) => {
          const isFlex = account.type === "uk_monzo_flex";
          const name = isFlex
            ? "Monzo Flex"
            : account.type === "uk_business"
              ? "Monzo business account"
              : account.type === "uk_retail_joint"
                ? "Monzo joint account"
                : "Monzo current account";
          const [rawBalance, rawPots] = await Promise.all([
            this.get(`/balance?${new URLSearchParams({ account_id: account.id })}`, accessToken),
            isFlex
              ? Promise.resolve({ pots: [] })
              : this.get(
                  `/pots?${new URLSearchParams({ current_account_id: account.id })}`,
                  accessToken,
                ),
          ]);
          const balance = balanceSchema.safeParse(rawBalance),
            pots = potsSchema.safeParse(rawPots);
          if (!balance.success || !pots.success)
            throw new MonzoError("Monzo returned incomplete balances or a non-GBP account.");
          // total_balance includes pots, so use the separate main balance exactly once.
          balances.push({
            id: account.id,
            parentAccountId: account.id,
            name,
            kind: isFlex ? "debt" : "cash",
            type: "account",
            balance: pence(balance.data.balance),
          });
          for (const pot of pots.data.pots.filter((pot) => !pot.deleted)) {
            if (pot.currency !== "GBP") throw new MonzoError("Only GBP Monzo pots can be tracked.");
            balances.push({
              id: pot.id,
              parentAccountId: account.id,
              name: pot.name,
              kind: "cash",
              type: "pot",
              balance: pence(pot.balance),
            });
          }
        }),
    );
    balances.sort(
      (a, b) =>
        a.parentAccountId.localeCompare(b.parentAccountId) ||
        (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "account" ? -1 : 1),
    );
    for (const balance of balances) {
      if (seen.has(balance.id))
        throw new MonzoError("Monzo returned duplicate accounts or pots. Try again.");
      seen.add(balance.id);
    }
    return { balances, fetchedAt: this.now().toISOString() };
  }
  async revoke(accessToken: string) {
    await this.request("/oauth2/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}
