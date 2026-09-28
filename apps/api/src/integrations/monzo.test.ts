import { expect, it, vi } from "vitest";
import { MonzoClient } from "./monzo";

const credentials = { clientId: "client", clientSecret: "secret" };
const now = () => new Date("2026-09-28T12:00:00Z");
it("keeps secrets out of authorization URLs and encodes a session-bound state", () => {
  const url = new URL(
    new MonzoClient().authorizeUrl(
      credentials.clientId,
      "https://wealth.example/auth/monzo/callback",
      "unguessable-state",
    ),
  );
  expect(url.origin).toBe("https://auth.monzo.com");
  expect(url.searchParams.get("state")).toBe("unguessable-state");
  expect(url.searchParams.has("client_secret")).toBe(false);
});
it("exchanges and rotates tokens using confidential form requests", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 21600,
      token_type: "Bearer",
      user_id: "user",
    }),
  );
  const client = new MonzoClient(fetcher, now);
  expect(await client.refresh(credentials, "old-refresh")).toEqual({
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: "2026-09-28T18:00:00.000Z",
    userId: "user",
  });
  const [url, request] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe("https://api.monzo.com/oauth2/token");
  expect(request?.method).toBe("POST");
  expect((request!.body as URLSearchParams).get("refresh_token")).toBe("old-refresh");
  expect(request?.redirect).toBe("error");
});
it("requires a refresh token rather than saving nonrenewable access", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      access_token: "access",
      expires_in: 21600,
      token_type: "Bearer",
      user_id: "user",
    }),
  );
  await expect(
    new MonzoClient(fetcher).exchange(credentials, "code", "https://wealth.example/callback"),
  ).rejects.toThrow("confidential");
});
it("uses main balance plus live pots once, excludes deleted pots and closed accounts, and preserves pence", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/accounts")
      return Response.json({
        accounts: [
          { id: "acc", description: "Personal", type: "uk_retail" },
          { id: "closed", description: "Closed", closed: true },
        ],
      });
    if (url.pathname === "/balance")
      return Response.json({ balance: -500, total_balance: 19500, currency: "GBP" });
    if (url.pathname === "/pots")
      return Response.json({
        pots: [
          { id: "live", name: "Savings", balance: 20000, currency: "GBP", deleted: false },
          { id: "deleted", name: "Old", balance: 10000, currency: "GBP", deleted: true },
        ],
      });
    throw new Error("Unexpected endpoint");
  });
  const result = await new MonzoClient(fetcher, now).value("access");
  expect(result.balances.map((balance) => [balance.id, balance.balance])).toEqual([
    ["acc", -500],
    ["live", 20000],
  ]);
  expect(result.balances.reduce((sum, balance) => sum + balance.balance, 0)).toBe(19500);
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const [, request] of fetcher.mock.calls) expect(request?.method).toBe("GET");
});
it.each([401, 403, 429, 500])(
  "returns safe errors for status %i without exposing response bodies",
  async (status) => {
    const client = new MonzoClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("sensitive provider detail", { status })),
    );
    const error = await client.value("private-token").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("sensitive");
    expect(String(error)).not.toContain("private-token");
  },
);
it("rejects missing balance data rather than treating it as zero", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      new URL(String(input)).pathname === "/accounts"
        ? Response.json({ accounts: [{ id: "acc", description: "Personal" }] })
        : Response.json({}),
    );
  await expect(new MonzoClient(fetcher).value("token")).rejects.toThrow("incomplete balances");
});

it("includes business and Flex with clear names and debt classification, without querying Flex pots or backing loans", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/accounts")
      return Response.json({
        accounts: [
          {
            id: "personal",
            description: "user_private-identifier",
            type: "uk_retail",
            closed: false,
          },
          {
            id: "business",
            description: "business_private-identifier",
            type: "uk_business",
            closed: false,
          },
          {
            id: "flex",
            description: "monzoflex_private-identifier",
            type: "uk_monzo_flex",
            closed: false,
          },
          {
            id: "backing",
            description: "Backing loan",
            type: "uk_monzo_flex_backing_loan",
            closed: false,
          },
          { id: "loan", description: "Loan", type: "uk_loan", closed: false },
          { id: "rewards", description: "Rewards", type: "uk_rewards", closed: false },
          { id: "closed-business", description: "Closed", type: "uk_business", closed: true },
        ],
      });
    if (url.pathname === "/balance") {
      const id = url.searchParams.get("account_id");
      if (!["personal", "business", "flex"].includes(id!))
        throw new Error("Unexpected balance request");
      return Response.json({ balance: id === "flex" ? -12000 : 35589, currency: "GBP" });
    }
    if (url.pathname === "/pots") {
      if (url.searchParams.get("current_account_id") === "flex")
        throw new Error("Flex has no pots");
      return Response.json({ pots: [] });
    }
    throw new Error("Unexpected endpoint");
  });
  const value = await new MonzoClient(fetcher, now).value("access");
  expect(value.balances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "personal", name: "Monzo current account", kind: "cash" }),
      expect.objectContaining({
        id: "business",
        name: "Monzo business account",
        kind: "cash",
        balance: 35589,
      }),
      expect.objectContaining({ id: "flex", name: "Monzo Flex", kind: "debt", balance: -12000 }),
    ]),
  );
  expect(value.balances).toHaveLength(3);
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(value)).not.toContain("private-identifier");
});
