import { formatGbp } from "@wealth/domain";
import type { Pence } from "@wealth/domain";
export function formatSignedGbp(value: Pence) {
  return `${value > 0 ? "+" : ""}${formatGbp(value)}`;
}
