import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export const sessionLifetimeSeconds = 45 * 24 * 60 * 60;
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
