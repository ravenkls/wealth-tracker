import { z } from "zod";
import Decimal from "decimal.js";
import { pence } from "@wealth/domain";
import type { Pence } from "@wealth/domain";

const numeric = z.number().finite();
const summarySchema = z.object({
  id: z.number().int().safe(),
  currency: z.string(),
  totalValue: numeric,
  cash: z.object({ availableToTrade: numeric, inPies: numeric, reservedForOrders: numeric }),
  investments: z.object({ currentValue: numeric }),
});
const positionSchema = z.object({
  instrument: z.object({ ticker: z.string(), name: z.string(), currency: z.string() }),
  quantity: numeric,
  walletImpact: z.object({ currency: z.string(), currentValue: numeric }),
});
const transactionSchema = z.object({
  reference: z.string(),
  amount: numeric,
  currency: z.string(),
  dateTime: z.iso.datetime({ offset: true }),
  type: z.string(),
});
const dividendSchema = z.object({
  reference: z.string(),
  amount: numeric,
  currency: z.string(),
  paidOn: z.iso.datetime({ offset: true }),
  type: z.string(),
});
const pathPrefix = "/api/v0/equity/";
const origin = "https://live.trading212.com";

export interface TradingCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
}
export interface InvestmentValuation {
  readonly providerId: string;
  readonly total: Pence;
  readonly cash: Pence;
  readonly fetchedAt: string;
  readonly positions: readonly { ticker: string; name: string; quantity: number; value: Pence }[];
}
export interface ProviderCashEvent {
  readonly reference: string;
  readonly amount: Pence;
  readonly occurredAt: string;
  readonly type: string;
  readonly source: "transaction" | "dividend";
}
export class Trading212Error extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "Trading212Error";
  }
}
export interface InvestmentProvider {
  value(credentials: TradingCredentials): Promise<InvestmentValuation>;
  transactions(
    credentials: TradingCredentials,
    path?: string,
  ): Promise<{ events: ProviderCashEvent[]; nextPage: string | null }>;
  dividends(
    credentials: TradingCredentials,
    path?: string,
  ): Promise<{ events: ProviderCashEvent[]; nextPage: string | null }>;
}
function gbp(value: number): Pence {
  return pence(new Decimal(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
}
function requireGbp(currency: string) {
  if (currency !== "GBP")
    throw new Trading212Error(
      "This app requires a GBP Trading 212 account and GBP cash movements.",
    );
}

export class Trading212Client implements InvestmentProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async get(credentials: TradingCredentials, path: string): Promise<unknown> {
    const url = new URL(path, origin);
    if (
      url.origin !== origin ||
      !url.pathname.startsWith(pathPrefix) ||
      url.username ||
      url.password
    )
      throw new Trading212Error("Trading 212 returned an invalid pagination link.");
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Trading212Error("Trading 212 could not be reached. Try again.");
    }
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        throw new Trading212Error(
          "Trading 212 is rate limiting requests. Wait before retrying.",
          Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new Trading212Error(
          "Trading 212 rejected these credentials. Check the API key, secret and read permissions.",
        );
      throw new Trading212Error("Trading 212 could not provide the requested data. Try again.");
    }
    try {
      return await response.json();
    } catch {
      throw new Trading212Error("Trading 212 returned an invalid response.");
    }
  }
  async value(credentials: TradingCredentials): Promise<InvestmentValuation> {
    const [summaryRaw, positionsRaw] = await Promise.all([
      this.get(credentials, `${pathPrefix}account/summary`),
      this.get(credentials, `${pathPrefix}positions`),
    ]);
    const summary = summarySchema.safeParse(summaryRaw);
    const positions = z.array(positionSchema).safeParse(positionsRaw);
    if (!summary.success || !positions.success)
      throw new Trading212Error("Trading 212 returned incomplete account data.");
    requireGbp(summary.data.currency);
    return {
      providerId: String(summary.data.id),
      total: gbp(summary.data.totalValue),
      cash: gbp(
        new Decimal(summary.data.cash.availableToTrade)
          .plus(summary.data.cash.inPies)
          .plus(summary.data.cash.reservedForOrders)
          .toNumber(),
      ),
      fetchedAt: this.now().toISOString(),
      positions: positions.data.map((position) => {
        requireGbp(position.walletImpact.currency);
        return {
          ticker: position.instrument.ticker,
          name: position.instrument.name,
          quantity: position.quantity,
          value: gbp(position.walletImpact.currentValue),
        };
      }),
    };
  }
  async transactions(
    credentials: TradingCredentials,
    path = `${pathPrefix}history/transactions?limit=50`,
  ) {
    this.requirePath(path, "transactions");
    const result = z
      .object({ items: z.array(transactionSchema), nextPagePath: z.string().nullish() })
      .safeParse(await this.get(credentials, path));
    if (!result.success)
      throw new Trading212Error("Trading 212 returned incomplete cash movement history.");
    return {
      events: result.data.items.map((item) => {
        requireGbp(item.currency);
        return {
          reference: item.reference,
          amount: gbp(item.amount),
          occurredAt: item.dateTime,
          type: item.type,
          source: "transaction" as const,
        };
      }),
      nextPage: result.data.nextPagePath || null,
    };
  }
  async dividends(
    credentials: TradingCredentials,
    path = `${pathPrefix}history/dividends?limit=50`,
  ) {
    this.requirePath(path, "dividends");
    const result = z
      .object({ items: z.array(dividendSchema), nextPagePath: z.string().nullish() })
      .safeParse(await this.get(credentials, path));
    if (!result.success)
      throw new Trading212Error("Trading 212 returned incomplete dividend history.");
    return {
      events: result.data.items.map((item) => {
        requireGbp(item.currency);
        return {
          reference: item.reference,
          amount: gbp(item.amount),
          occurredAt: item.paidOn,
          type: item.type,
          source: "dividend" as const,
        };
      }),
      nextPage: result.data.nextPagePath || null,
    };
  }
  private requirePath(path: string, resource: string) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.pathname !== `${pathPrefix}history/${resource}`)
      throw new Trading212Error("Trading 212 returned an invalid history pagination link.");
  }
}
