import { MonzoService } from "../application/monzo-service";
import { MonzoClient } from "../integrations/monzo";
import { hash } from "../auth/tokens";
import { WealthStore } from "../storage/records";
import { WealthService } from "../application/wealth-service";
import { SnapshotService } from "../application/snapshot-service";
import { ConnectionService } from "../application/connection-service";
import { LocalCredentialCipher } from "../auth/encryption";
import { Trading212Client } from "../integrations/trading212";
import { createServer } from "node:http";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { createRouter } from "../router";
import { readLocalConfig } from "./config";
import { createLocalDatabase, isTableReady } from "./database";
import { DynamoAuthStore } from "../auth/store";
import { GoogleIdentityProvider } from "../auth/google";
import { AuthService } from "../auth/service";
import { createAuthHandler } from "../http/auth-routes";
import { readCookies, sessionCookie, setCookie } from "../http/cookies";

const config = readLocalConfig(process.env);
const database = createLocalDatabase(config.databaseEndpoint);
const documents = DynamoDBDocumentClient.from(database, {
  marshallOptions: { removeUndefinedValues: true },
});
if (!config.googleClientId || !config.googleClientSecret)
  throw new Error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env to enable real Google sign-in.",
  );
const auth = new AuthService(
  new DynamoAuthStore(documents, config.tableName),
  new GoogleIdentityProvider(
    config.googleClientId,
    config.googleClientSecret,
    `${config.appOrigin}/auth/google/callback`,
  ),
);

if (!config.encryptionKey)
  throw new Error("Set LOCAL_ENCRYPTION_KEY in .env before storing connections.");
const wealthStore = new WealthStore(documents, config.tableName);
const cipher = new LocalCredentialCipher(config.encryptionKey);
const provider = new Trading212Client();
const monzo = new MonzoService(wealthStore, new MonzoClient(), cipher, config.appOrigin);
const handleAuth = createAuthHandler(auth, config.appOrigin, monzo);
const appRouter = createRouter({
  monzo,
  wealth: new WealthService(wealthStore),
  connections: new ConnectionService(wealthStore, provider, cipher),
  snapshots: new SnapshotService(wealthStore, provider, cipher, undefined, monzo),
  isDatabaseReady: () => isTableReady(database, config.tableName),
});
const handleApi = createHTTPHandler({
  router: appRouter,
  basePath: "/api/trpc/",
  createContext: async ({ req, res }) => {
    const cookies = readCookies(req.headers.cookie);
    const authenticated = await auth.authenticate(
      cookies[sessionCookie],
      req.headers["x-wealth-activity"] === "foreground",
    );
    if (authenticated && cookies[sessionCookie])
      setCookie(
        res,
        sessionCookie,
        cookies[sessionCookie],
        authenticated.expiresAt - Math.floor(Date.now() / 1000),
        false,
      );
    else if (cookies[sessionCookie]) setCookie(res, sessionCookie, "", 0, false);
    return {
      user: authenticated ? { userId: authenticated.userId, profile: authenticated.profile } : null,
      sessionHash: hash(cookies[sessionCookie] ?? ""),
      trustedOrigin: req.headers.origin === config.appOrigin,
    };
  },
});
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (await handleAuth(req, res)) return;
    if (req.url?.startsWith("/api/trpc/")) {
      await handleApi(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Service temporarily unavailable." }));
  }
});
server.listen(config.apiPort, "127.0.0.1", () =>
  console.log(`Local API ready. Open ${config.appOrigin}`),
);
function shutdown() {
  server.close(() => {
    database.destroy();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
