import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function gatewayRequest(event: APIGatewayProxyEventV2, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers))
    if (value !== undefined) headers.set(key, value);
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  const method = event.requestContext.http.method;
  return new Request(
    `${origin}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`,
    {
      method,
      headers,
      ...(event.body && method !== "GET" && method !== "HEAD"
        ? { body: Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8") }
        : {}),
    },
  );
}
export async function gatewayResponse(
  response: Response,
): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  for (const [key, value] of response.headers) if (key !== "set-cookie") headers[key] = value;
  return {
    statusCode: response.status,
    headers,
    cookies: response.headers.getSetCookie(),
    body: await response.text(),
    isBase64Encoded: false,
  };
}
