import type { backgroundApi } from "../../lib/api";

export type TransactionRow = Awaited<
  ReturnType<typeof backgroundApi.analysis.transactions.query>
>["rows"][number];

const day = 86400000;
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

// The transactions endpoint accepts ranges of up to a year, so longer exports are split.
export function yearChunks(from: string, to: string) {
  const chunks: { from: string; to: string }[] = [];
  for (let start = Date.parse(from); start <= Date.parse(to); start += 366 * day) {
    const end = Math.min(start + 365 * day, Date.parse(to));
    chunks.push({ from: isoDate(start), to: isoDate(end) });
  }
  return chunks;
}

// Quote per RFC 4180 and defuse leading formula characters so spreadsheets show text, not formulas.
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const columns = [
  "Date",
  "Merchant",
  "Description",
  "Amount",
  "Currency",
  "Category",
  "Account",
  "Excluded",
];

export function transactionsCsv(rows: readonly TransactionRow[]) {
  const lines = [...rows]
    .sort((a, b) => a.booking_date.localeCompare(b.booking_date))
    .map((row) =>
      [
        cell(row.booking_date),
        cell(row.merchant),
        cell(row.description),
        row.amount,
        cell(row.currency),
        cell(row.customCategory ?? ""),
        cell(row.sandbox ? `${row.accountName} (sandbox)` : row.accountName),
        row.excluded ? "yes" : "no",
      ].join(","),
    );
  return [columns.join(","), ...lines].join("\r\n") + "\r\n";
}
