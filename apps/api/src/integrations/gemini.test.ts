import { expect, it, vi } from "vitest";
import { GeminiBatchClient } from "./gemini";
import type { StoredEnduteTransaction } from "../storage/endute-transactions";
const row = {
  description: "TESCO",
  enrichment: { merchant_name: "Tesco" },
  counterparty: null,
  amount: "-12.00",
  currency: "GBP",
  accountName: "Private account name",
  end_to_end_id: "private-reference",
} as StoredEnduteTransaction;
it("submits batch-only structured classification without financial identifiers", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ name: "batches/batch-123" }));
  const client = new GeminiBatchClient(async () => "secret-key", "gemini-3.1-flash-lite", fetcher);
  const legacyCategories = [{ id: "groceries", name: "Groceries", description: "Supermarkets" }];
  expect(await client.submit("job", legacyCategories, [{ key: "tx_0", row }])).toBe(
    "batches/batch-123",
  );
  expect(fetcher.mock.calls[0]![0]).toContain(":batchGenerateContent");
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(
    body.batch.inputConfig.requests.requests[0].request.generationConfig.responseSchema.items
      .properties.categoryId.enum,
  ).toEqual(["groceries"]);
  expect(JSON.stringify(body)).not.toContain("Private account name");
  expect(JSON.stringify(body)).not.toContain("private-reference");
  expect(JSON.stringify(body)).not.toContain("secret-key");
  const prompt = JSON.parse(
    body.batch.inputConfig.requests.requests[0].request.contents[0].parts[0].text,
  );
  expect(prompt.categories).toEqual([{ id: "groceries", name: "Groceries" }]);
  expect(JSON.stringify(body)).not.toContain("Supermarkets");
});
it("accepts null and skips malformed, truncated and duplicate classifications", async () => {
  const response = (entries: unknown, finishReason = "STOP") => ({
    response: {
      candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(entries) }] } }],
    },
  });
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      name: "batches/test",
      done: true,
      response: {
        inlinedResponses: {
          inlinedResponses: [
            response([
              { key: "tx_0", categoryId: "food" },
              { key: "tx_1", categoryId: null },
              { key: "tx_0", categoryId: "duplicate" },
            ]),
            response([{ key: "tx_0", categoryId: "different" }]),
            response([{ key: "tx_2", categoryId: "food" }], "MAX_TOKENS"),
            { error: { code: 13 } },
          ],
        },
      },
    }),
  );
  const result = await new GeminiBatchClient(async () => "key", undefined, fetcher).get(
    "batches/test",
  );
  expect(result.done).toBe(true);
  expect([...result.results]).toEqual([["tx_1", null]]);
});
it("marks ambiguous submission errors without automatically repeating the POST", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("network");
  });
  await expect(
    new GeminiBatchClient(async () => "key", undefined, fetcher).submit(
      "job",
      [{ id: "food", name: "Food" }],
      [{ key: "tx_0", row }],
    ),
  ).rejects.toMatchObject({ uncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("distinguishes rejected requests and reconciles accepted jobs by display name", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      operations: [{ name: "batches/existing", metadata: { displayName: "our-job" } }],
    }),
  );
  expect(await new GeminiBatchClient(async () => "key", undefined, fetcher).find("our-job")).toBe(
    "batches/existing",
  );
  const rejected = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
  await expect(
    new GeminiBatchClient(async () => "key", undefined, rejected).submit("job", [], []),
  ).rejects.toMatchObject({ uncertain: false });
});
