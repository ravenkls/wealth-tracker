import { expect, it } from "vitest";
import { currentMonth, operationDigest } from "./snapshot-service";
it("selects the London calendar month at UTC boundaries in summer and winter", () => {
  expect(currentMonth(new Date("2026-08-31T23:30:00Z"))).toBe("2026-09");
  expect(currentMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
  expect(currentMonth(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
});
it("binds retry receipts to operation kind and inputs without object-key ordering", () => {
  expect(operationDigest("current", { a: 1, b: 2 })).toBe(
    operationDigest("current", { b: 2, a: 1 }),
  );
  expect(operationDigest("current", { a: 1 })).not.toBe(operationDigest("current", { a: 2 }));
  expect(operationDigest("current", { a: 1 })).not.toBe(operationDigest("historical", { a: 1 }));
});
