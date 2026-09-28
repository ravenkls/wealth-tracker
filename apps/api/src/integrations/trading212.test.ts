import { expect, it, vi } from "vitest";
import { Trading212Client } from "./trading212";
const credentials = { apiKey: "test-key", apiSecret: "test-secret" };
const summary = {
  id: 123,
  currency: "GBP",
  totalValue: 1000.01,
  cash: { availableToTrade: 100, inPies: 20, reservedForOrders: 30 },
  investments: { currentValue: 850.01 },
};
const positions = [
  {
    instrument: { ticker: "ABC", name: "Example", currency: "USD" },
    quantity: 2.5,
    walletImpact: { currency: "GBP", currentValue: 850.01 },
  },
];

it("uses the authoritative account total once, with GBP holdings as supporting detail", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(summary))
    .mockResolvedValueOnce(Response.json(positions));
  const client = new Trading212Client(fetcher, () => new Date("2026-09-28T12:00:00Z"));
  expect(await client.value(credentials)).toEqual({
    providerId: "123",
    total: 100001,
    cash: 15000,
    fetchedAt: "2026-09-28T12:00:00.000Z",
    positions: [{ ticker: "ABC", name: "Example", quantity: 2.5, value: 85001 }],
  });
  for (const [, request] of fetcher.mock.calls) expect(request?.method).toBe("GET");
});
it("rejects partial provider results rather than using zeros", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(summary))
    .mockResolvedValueOnce(new Response("", { status: 503 }));
  await expect(new Trading212Client(fetcher).value(credentials)).rejects.toThrow(
    "could not provide",
  );
});
it("rejects non-GBP account totals", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...summary, currency: "USD" }))
    .mockResolvedValueOnce(Response.json(positions));
  await expect(new Trading212Client(fetcher).value(credentials)).rejects.toThrow("requires a GBP");
});
it("does not follow a pagination link to another origin or endpoint", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new Trading212Client(fetcher);
  await expect(
    client.transactions(credentials, "https://example.com/api/v0/equity/history/transactions"),
  ).rejects.toThrow("invalid history pagination");
  await expect(client.dividends(credentials, "/api/v0/equity/orders")).rejects.toThrow(
    "invalid history pagination",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("returns history event types without guessing how transfers should be classified", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      items: [
        {
          reference: "r1",
          amount: 12.34,
          currency: "GBP",
          dateTime: "2026-09-01T00:00:00Z",
          type: "TRANSFER",
        },
      ],
      nextPagePath: null,
    }),
  );
  expect((await new Trading212Client(fetcher).transactions(credentials)).events[0]).toMatchObject({
    amount: 1234,
    type: "TRANSFER",
    source: "transaction",
  });
});
it("keeps credentials and response bodies out of provider errors", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("sensitive provider body", { status: 401 }));
  await expect(new Trading212Client(fetcher).transactions(credentials)).rejects.toThrow(
    "rejected these credentials",
  );
});
