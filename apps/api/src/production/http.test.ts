import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { gatewayRequest, gatewayResponse } from "./http";
import { formatCookie } from "../http/cookies";

describe("API Gateway HTTP v2 transport", () => {
  it("preserves cookie arrays, query strings and base64 mutation bodies", async () => {
    const event: APIGatewayProxyEventV2 = {
      version: "2.0",
      routeKey: "$default",
      rawPath: "/api/trpc/snapshot.save",
      rawQueryString: "batch=1",
      headers: { origin: "https://wealth.example", "content-type": "application/json" },
      cookies: ["wealth_session=opaque", "wealth_oauth=binding"],
      body: Buffer.from('{"value":42}').toString("base64"),
      isBase64Encoded: true,
      requestContext: {
        accountId: "test",
        apiId: "test",
        domainName: "gateway.example",
        domainPrefix: "gateway",
        requestId: "test",
        routeKey: "$default",
        stage: "$default",
        time: "",
        timeEpoch: 0,
        http: {
          method: "POST",
          path: "/api/trpc/snapshot.save",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
      },
    };
    const request = gatewayRequest(event, "https://wealth.example");
    expect(request.url).toBe("https://wealth.example/api/trpc/snapshot.save?batch=1");
    expect(request.headers.get("cookie")).toBe("wealth_session=opaque; wealth_oauth=binding");
    expect(request.headers.get("origin")).toBe("https://wealth.example");
    expect(await request.json()).toEqual({ value: 42 });
  });
  it("returns separate secure Set-Cookie values on redirects", async () => {
    const headers = new Headers({ Location: "/" });
    headers.append("Set-Cookie", formatCookie("wealth_oauth", "", 0, true));
    headers.append("Set-Cookie", formatCookie("wealth_session", "token", 100, true));
    const response = await gatewayResponse(new Response(null, { status: 302, headers }));
    expect(response.statusCode).toBe(302);
    expect(response.cookies).toEqual([
      "wealth_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
      "wealth_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=100; Secure",
    ]);
    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(response.headers?.["set-cookie"]).toBeUndefined();
  });
});
