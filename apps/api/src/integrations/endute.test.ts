import { expect, it, vi } from "vitest";
import { EnduteClient, EnduteError } from "./endute";

const id = "6f2b6c0e-7d1a-4a2e-9f0b-2c9a1e5d4b3a";
const otherId = "b8e4d2a1-1c3f-4e5a-8b6d-0f2a7c9e1d4b";
const stamp = "2026-09-28T09:14:22Z";
const account = {
  id,
  institution: "Bank",
  name: "Savings",
  account_type: "savings",
  currency: "GBP",
  sandbox: false,
  consent_renewal_due: null,
};
const balance = { account_id: id, balance: "1284.5650", currency: "GBP", fetched_at: stamp };
function fixture(
  accounts: unknown[] = [account],
  balances: unknown[] = [balance],
  connections: unknown[] = [],
) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/accounts") return Response.json(accounts);
    if (path === "/v1/connections") return Response.json(connections);
    return Response.json(
      balances.find((value) => (value as typeof balance).account_id === path.split("/")[3]) ?? null,
    );
  });
  return { fetcher, client: new EnduteClient(fetcher, () => new Date("2026-09-30T12:00:00Z")) };
}
it("uses server-side bearer authentication, exact paths, decimal rounding and cached timestamps", async () => {
  const f = fixture();
  expect(await f.client.value("private-key")).toMatchObject({
    fetchedAt: stamp,
    balances: [{ id, name: "Bank · Savings", kind: "cash", balance: 128457, fetchedAt: stamp }],
    warnings: [],
  });
  for (const [url, options] of f.fetcher.mock.calls) {
    expect(String(url)).toMatch(/^https:\/\/api.endute.com\/v1\//);
    expect(options).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer private-key" },
    });
  }
});
it("preserves signed card debt and labels sandbox accounts", async () => {
  const f = fixture(
    [{ ...account, account_type: "credit_card", sandbox: true }],
    [{ ...balance, balance: "-100.0050" }],
  );
  expect((await f.client.value("key")).balances[0]).toMatchObject({
    kind: "debt",
    balance: -10001,
    sandbox: true,
    name: "Bank · Savings (Sandbox)",
  });
});
it("does not invent zero balances before the first sync", async () => {
  const value = await fixture(
    [account],
    [{ ...balance, balance: null, fetched_at: null }],
  ).client.value("key");
  expect(value.balances).toEqual([]);
  expect(value.accountIds).toEqual([id]);
  expect(value.warnings.join()).toContain("first balance sync");
});
it("excludes unsupported currencies and unknown types without requesting their balances", async () => {
  const f = fixture([
    { ...account, currency: "EUR" },
    { ...account, id: otherId, account_type: null },
  ]);
  const value = await f.client.value("key");
  expect(value.balances).toEqual([]);
  expect(value.accountIds).toHaveLength(2);
  expect(value.warnings).toHaveLength(2);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it("uses connection status and consent due dates to warn while retaining cached data", async () => {
  const f = fixture(
    [{ ...account, consent_renewal_due: "2026-10-02T00:00:00Z" }],
    [balance],
    [{ id: otherId, institution: "Bank", status: "expired" }],
  );
  const value = await f.client.value("key");
  expect(value.balances).toHaveLength(1);
  expect(value.warnings.join()).toContain("expired");
  expect(value.warnings.join()).toContain("2026-10-02");
});
it.each([
  { ...balance, currency: "USD" },
  { ...balance, balance: "invalid" },
  { ...balance, balance: "9007199254740992" },
  { ...balance, fetched_at: "yesterday" },
])("rejects inconsistent or malformed balances without partial results", async (invalid) => {
  await expect(fixture([account], [invalid]).client.value("key")).rejects.toBeInstanceOf(
    EnduteError,
  );
});
it.each([
  [401, "invalid_api_key", "rejected"],
  [403, "subscription_lapsed", "Renew"],
  [403, "connect_not_available", "unavailable"],
  [500, "server_error", "could not provide"],
] as const)("maps %i %s to a safe actionable error", async (status, code, message) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ error: { code, message: "secret from upstream" } }, { status }),
    );
  await expect(new EnduteClient(fetcher).value("key")).rejects.toThrow(message);
});
it("exposes Retry-After without echoing upstream text", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json(
        { error: { code: "throttled" } },
        { status: 429, headers: { "Retry-After": "42" } },
      ),
    );
  await expect(new EnduteClient(fetcher).value("key")).rejects.toMatchObject({
    code: "throttled",
    retryAfterSeconds: 42,
  });
});
it("rejects duplicate identities and invalid JSON", async () => {
  await expect(fixture([account, account]).client.value("key")).rejects.toThrow("duplicate");
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("not json"));
  await expect(new EnduteClient(fetcher).value("key")).rejects.toThrow("incomplete");
});

const transaction = {
  id: "d1c2b3a4-5e6f-4708-9a0b-1c2d3e4f5061",
  booking_date: "2026-09-28",
  value_date: "2026-09-28",
  amount: "-12.80",
  currency: "GBP",
  description: "TESCO STORES",
  counterparty: "Tesco",
  enrichment: {
    merchant_name: "Tesco",
    category: "Groceries",
    brand_domain: "tesco.com",
    confidence: null,
    source: null,
  },
  sandbox: false,
};
it("fetches complete transaction metadata with date filters and validated next links", async () => {
  const next = `https://api.endute.com/v1/accounts/${id}/transactions?cursor=next`;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ results: [transaction], next }));
  const client = new EnduteClient(fetcher);
  expect(
    await client.transactions("key", id, undefined, "2026-09-20", AbortSignal.timeout(1000)),
  ).toEqual({ results: [transaction], next });
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    `https://api.endute.com/v1/accounts/${id}/transactions?from=2026-09-20`,
  );
  await client.transactions("key", id, next, null, AbortSignal.timeout(1000));
  expect(String(fetcher.mock.calls[1]?.[0])).toBe(next);
});
it.each([
  "https://attacker.example/transactions",
  `https://api.endute.com/v1/accounts/${otherId}/transactions`,
  `https://user:password@api.endute.com/v1/accounts/${id}/transactions`,
  `https://api.endute.com/v1/accounts/${id}/balances`,
])("rejects unsafe transaction pagination without sending credentials: %s", async (path) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    new EnduteClient(fetcher).transactions("secret", id, path, null, AbortSignal.timeout(1000)),
  ).rejects.toThrow("pagination");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects hostile next URLs and malformed transaction rows before ingestion", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ results: [transaction], next: "https://attacker.example/next" }),
    );
  const client = new EnduteClient(fetcher);
  await expect(
    client.transactions("key", id, undefined, null, AbortSignal.timeout(1000)),
  ).rejects.toThrow("pagination");
  fetcher.mockImplementation(async () =>
    Response.json({ results: [{ ...transaction, booking_date: "yesterday" }], next: null }),
  );
  await expect(
    client.transactions("key", id, undefined, null, AbortSignal.timeout(1000)),
  ).rejects.toThrow("incomplete");
});
