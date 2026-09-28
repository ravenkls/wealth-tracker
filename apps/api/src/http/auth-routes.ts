import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "../auth/service";
import { createAuthRequestHandler } from "./auth-request";

export function createAuthHandler(auth: AuthService, origin: string) {
  const handle = createAuthRequestHandler(auth, origin);
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? "/", origin);
    if (!url.pathname.startsWith("/auth/")) return false;
    if (
      request.method === "GET" &&
      url.pathname === "/auth/google" &&
      request.headers.host !== new URL(origin).host
    ) {
      response.writeHead(302, { Location: `${origin}/auth/google`, "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const result = await handle(new Request(url, { method: request.method ?? "GET", headers }));
    if (!result) return false;
    for (const [key, value] of result.headers)
      if (key !== "set-cookie") response.setHeader(key, value);
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("Set-Cookie", cookies);
    response.writeHead(result.status);
    response.end();
    return true;
  };
}
