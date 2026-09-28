import type { Snapshot } from "./models";

/** Date-only historical readings use the start of that date in Europe/London. */
export function readingAt(snapshot: Snapshot): string | null {
  if (snapshot.source === "current") return snapshot.capturedAt;
  const date = snapshot.historicalSavings?.readingDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const midnight = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date)
    return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(midnight),
  );
  return new Date(midnight.getTime() - hour * 3_600_000).toISOString();
}
export function savingsConnectionIds(snapshot: Snapshot): string[] {
  return snapshot.source === "historical"
    ? [...(snapshot.historicalSavings?.connectionIds ?? [])]
    : snapshot.investments.map((investment) => investment.connectionId);
}
