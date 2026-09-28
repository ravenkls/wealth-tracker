export type Pence = number & { readonly __unit: "GBP-pence" };

export function pence(value: number): Pence {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Money must be a safe integer number of pence.");
  }
  return (Object.is(value, -0) ? 0 : value) as Pence;
}

export function parseGbp(input: string): Pence {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error("Enter a GBP amount with at most two decimal places.");
  const [, sign, whole, fraction = ""] = match;
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return pence(Number(sign === "-" ? -amount : amount));
}

export function sumMoney(values: readonly Pence[]): Pence {
  const total = values.reduce((sum, value) => sum + BigInt(pence(value)), 0n);
  return pence(Number(total));
}

const formatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGbp(value: Pence): string {
  const amount = BigInt(pence(value));
  const absolute = amount < 0n ? -amount : amount;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  const formatted = formatter
    .formatToParts(absolute / 100n)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
  return `${amount < 0n ? "-" : ""}${formatted}`;
}
