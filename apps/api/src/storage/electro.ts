// Batch reads return throttled keys as unprocessed; retry those with backoff.
export async function getAll<K, T>(
  read: (keys: K[]) => Promise<{ data: T[]; unprocessed: K[] }>,
  keys: K[],
  message: string,
) {
  const found: T[] = [];
  let pending = keys;
  for (let attempt = 0; pending.length && attempt < 5; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    const result = await read(pending);
    found.push(...result.data);
    pending = result.unprocessed;
  }
  if (pending.length) throw new Error(message);
  return found;
}
// False when only condition checks failed; any other cancellation is unexpected.
export function committed(result: { canceled: boolean; data: { code?: string }[] }) {
  if (!result.canceled) return true;
  const codes = result.data.map((item) => item.code ?? "None");
  if (
    codes.includes("ConditionalCheckFailed") &&
    codes.every((code) => code === "None" || code === "ConditionalCheckFailed")
  )
    return false;
  throw new Error(`DynamoDB transaction was cancelled: ${codes.join(", ")}.`);
}
