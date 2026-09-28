import type { ServerResponse } from "node:http";
export const sessionCookie = "wealth_session";
export const attemptCookie = "wealth_oauth";
export function readCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header?.split(";") ?? []) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    try {
      result[name] = decodeURIComponent(pair.slice(index + 1));
    } catch {
      /* Ignore malformed cookies. */
    }
  }
  return result;
}
export function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
) {
  const cookie = formatCookie(name, value, maxAge, secure);
  const existing = response.getHeader("set-cookie");
  response.setHeader("set-cookie", [
    ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
    cookie,
  ]);
}
export function formatCookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? "; Secure" : ""}`;
}
