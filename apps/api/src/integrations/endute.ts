import Decimal from "decimal.js";
import { z } from "zod";
import { pence, type BankBalance } from "@wealth/domain";

const timestamp = z.iso.datetime({ offset: true });
const accountSchema = z.object({
  id: z.uuid(),
  institution: z.string(),
  name: z.string(),
  account_type: z.string().nullable(),
  currency: z.string(),
  sandbox: z.boolean(),
  consent_renewal_due: timestamp.nullable(),
});
const balanceSchema = z.object({
  account_id: z.uuid(),
  balance: z
    .string()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .nullable(),
  currency: z.string(),
  fetched_at: timestamp.nullable(),
});
const connectionSchema = z.object({
  id: z.uuid(),
  institution: z.string(),
  status: z.string(),
});

export interface EnduteValuation {
  balances: BankBalance[];
  fetchedAt: string;
  accountIds: string[];
  warnings: string[];
}
export interface EnduteProvider {
  value(apiKey: string): Promise<EnduteValuation>;
}
export class EnduteError extends Error {
  constructor(
    message: string,
    readonly code = "unavailable",
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "EnduteError";
  }
}

export class EnduteClient implements EnduteProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async get<T>(
    apiKey: string,
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.endute.com/v1${path}`, {
        method: "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
    } catch {
      throw new EnduteError("Endute Connect could not be reached. Try again.");
    }
    if (!response.ok) {
      const envelope = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json().catch(() => null));
      const code = envelope.success ? envelope.data.error.code : "unavailable";
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        throw new EnduteError(
          "Endute Connect is rate limiting requests. Wait before retrying.",
          "throttled",
          Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
        );
      }
      if (code === "subscription_lapsed")
        throw new EnduteError(
          "Renew your Endute subscription in the portal to resume access.",
          code,
        );
      if (response.status === 401)
        throw new EnduteError(
          "Endute rejected the API key. Check your account or replace the key.",
          "invalid_api_key",
        );
      if (response.status === 403)
        throw new EnduteError(
          "API access is unavailable for this Endute account. Check the Endute portal.",
          code,
        );
      throw new EnduteError(
        "Endute Connect could not provide the requested data. Try again.",
        code,
      );
    }
    const result = schema.safeParse(await response.json().catch(() => null));
    if (!result.success) throw new EnduteError("Endute Connect returned incomplete account data.");
    return result.data;
  }

  async value(apiKey: string): Promise<EnduteValuation> {
    const signal = AbortSignal.timeout(20000);
    const [accounts, connections] = await Promise.all([
      this.get(apiKey, "/accounts", z.array(accountSchema), signal),
      this.get(apiKey, "/connections", z.array(connectionSchema), signal),
    ]);
    if (new Set(accounts.map((account) => account.id)).size !== accounts.length)
      throw new EnduteError("Endute Connect returned duplicate account identifiers.");
    const warnings: string[] = [];
    for (const connection of connections) {
      if (connection.status !== "linked")
        warnings.push(
          `${connection.institution}: ${connection.status}. Check or renew access in the Endute portal; balances may be stale.`,
        );
    }
    const eligible = accounts.filter((account) => {
      const supported =
        account.currency === "GBP" &&
        ["current", "savings", "cash", "credit_card", "loan"].includes(account.account_type ?? "");
      if (!supported)
        warnings.push(
          `${account.name}: only GBP cash, savings and debt accounts with a known account type can be tracked. Check the type in the Endute portal.`,
        );
      if (
        account.consent_renewal_due &&
        Date.parse(account.consent_renewal_due) <= this.now().getTime() + 10 * 86400000
      )
        warnings.push(
          `${account.name}: renew bank access in the Endute portal by ${account.consent_renewal_due.slice(0, 10)}.`,
        );
      return supported;
    });
    if (eligible.length > 80)
      throw new EnduteError(
        "Up to 80 Endute bank accounts are supported. Adjust enabled accounts in the Endute portal.",
      );
    const balances: BankBalance[] = [];
    // Bound concurrency and requests: one list and one balance read per supported account.
    for (let offset = 0; offset < eligible.length; offset += 5) {
      const batch = await Promise.all(
        eligible.slice(offset, offset + 5).map(async (account) => {
          const value = await this.get(
            apiKey,
            `/accounts/${account.id}/balances`,
            balanceSchema,
            signal,
          );
          if (value.account_id !== account.id || value.currency !== "GBP")
            throw new EnduteError("Endute returned a mismatched account or balance currency.");
          if (value.balance === null || value.fetched_at === null) {
            warnings.push(`${account.name}: waiting for the first balance sync in Endute.`);
            return null;
          }
          const amount = new Decimal(value.balance)
            .times(100)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber();
          if (!Number.isSafeInteger(amount))
            throw new EnduteError("An Endute balance is outside the supported range.");
          return {
            id: account.id,
            parentAccountId: account.id,
            name: `${account.institution} · ${account.name}${account.sandbox ? " (Sandbox)" : ""}`,
            type: "account" as const,
            kind:
              account.account_type === "credit_card" || account.account_type === "loan"
                ? ("debt" as const)
                : ("cash" as const),
            balance: pence(amount),
            fetchedAt: value.fetched_at,
            sandbox: account.sandbox,
          };
        }),
      );
      balances.push(...batch.filter((value) => value !== null));
    }
    return {
      balances,
      // Per-account timestamps are authoritative; the summary uses the oldest cached balance.
      fetchedAt:
        balances
          .map((balance) => balance.fetchedAt!)
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? this.now().toISOString(),
      accountIds: accounts.map((account) => account.id),
      warnings,
    };
  }
}
