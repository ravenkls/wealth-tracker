import type { MonzoService } from "../application/monzo-service";
import { hash } from "../auth/tokens";
import type { AuthService } from "../auth/service";
import { attemptCookie, readCookies, sessionCookie, formatCookie } from "./cookies";

export function createAuthRequestHandler(
  auth: AuthService,
  origin: string,
  monzo?: Pick<MonzoService, "complete">,
) {
  const secure = new URL(origin).protocol === "https:";
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/auth/")) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const cookies = readCookies(request.headers.get("cookie") ?? undefined);
    const cookie = (name: string, value: string, age: number) =>
      headers.append("Set-Cookie", formatCookie(name, value, age, secure));
    const respond = (status: number, location?: string) => {
      if (location) headers.set("Location", location);
      return new Response(null, { status, headers });
    };
    try {
      if (request.method === "GET" && url.pathname === "/auth/monzo/callback" && monzo) {
        const sessionToken = cookies[sessionCookie];
        const user = await auth.authenticate(sessionToken, false);
        const code = url.searchParams.get("code"),
          state = url.searchParams.get("state");
        if (!user || !sessionToken || !code || !state || state.length > 200 || code.length > 2000)
          throw new Error("Incomplete Monzo callback");
        const id = await monzo.complete(user.userId, hash(sessionToken), state, code);
        return respond(302, `/accounts?monzo=${encodeURIComponent(id)}`);
      }
      if (request.method === "GET" && url.pathname === "/auth/google") {
        const result = await auth.start();
        cookie(attemptCookie, result.binding, 600);
        return respond(302, result.url);
      }
      if (request.method === "GET" && url.pathname === "/auth/google/callback") {
        cookie(attemptCookie, "", 0);
        const code = url.searchParams.get("code"),
          state = url.searchParams.get("state"),
          binding = cookies[attemptCookie];
        if (!code || !state || !binding) throw new Error("Incomplete callback");
        const session = await auth.complete(code, state, binding);
        await auth.logout(cookies[sessionCookie]);
        cookie(sessionCookie, session.token, session.expiresAt - Math.floor(Date.now() / 1000));
        return respond(302, "/");
      }
      if (request.method === "POST" && url.pathname === "/auth/logout") {
        if (request.headers.get("origin") !== origin) return respond(403);
        await auth.logout(cookies[sessionCookie]);
        cookie(sessionCookie, "", 0);
        return respond(204);
      }
      return respond(404);
    } catch {
      if (url.pathname === "/auth/monzo/callback")
        return respond(302, "/accounts?monzoError=connection-failed");
      return url.pathname === "/auth/logout"
        ? respond(503)
        : respond(302, "/?authError=sign-in-failed");
    }
  };
}
