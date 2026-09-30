import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { runEnduteSchedule } from "../application/endute-scheduler";
import { EnduteTransactionsService } from "../application/endute-transactions";
import { EnduteService } from "../application/endute-service";
import { EnduteClient } from "../integrations/endute";
import { MonzoService } from "../application/monzo-service";
import { MonzoClient } from "../integrations/monzo";
import { hash } from "../auth/tokens";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";
import { AuthService } from "../auth/service";
import { DynamoAuthStore } from "../auth/store";
import { GoogleIdentityProvider } from "../auth/google";
import { WealthStore } from "../storage/records";
import { WealthService } from "../application/wealth-service";
import { SnapshotService } from "../application/snapshot-service";
import { ConnectionService } from "../application/connection-service";
import { Trading212Client } from "../integrations/trading212";
import { createRouter } from "../router";
import { createAuthRequestHandler } from "../http/auth-request";
import { formatCookie, readCookies, sessionCookie } from "../http/cookies";
import { KmsCredentialCipher } from "./cipher";
import { gatewayRequest, gatewayResponse } from "./http";

const configSchema = z.object({
  APP_ORIGIN: z.url().startsWith("https://"),
  DYNAMODB_TABLE: z.string().min(1),
  CREDENTIAL_KEY_ARN: z.string().min(1),
  GOOGLE_SECRET_ARN: z.string().min(1),
});
async function initialize() {
  const config = configSchema.parse(process.env);
  const database = new DynamoDBClient({
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
  const documents = DynamoDBDocumentClient.from(database, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const secret = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: config.GOOGLE_SECRET_ARN }),
  );
  const google = z
    .object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
    .parse(JSON.parse(secret.SecretString ?? "{}"));
  const auth = new AuthService(
    new DynamoAuthStore(documents, config.DYNAMODB_TABLE),
    new GoogleIdentityProvider(
      google.clientId,
      google.clientSecret,
      `${config.APP_ORIGIN}/auth/google/callback`,
    ),
  );
  const store = new WealthStore(documents, config.DYNAMODB_TABLE);
  const provider = new Trading212Client();
  const cipher = new KmsCredentialCipher(new KMSClient({}), config.CREDENTIAL_KEY_ARN);
  const monzo = new MonzoService(store, new MonzoClient(), cipher, config.APP_ORIGIN);
  const enduteClient = new EnduteClient();
  const analysis = new EnduteTransactionsService(store, enduteClient, cipher);
  const endute = new EnduteService(store, enduteClient, cipher);
  const router = createRouter({
    monzo,
    endute,
    analysis,
    wealth: new WealthService(store),
    connections: new ConnectionService(store, provider, cipher),
    snapshots: new SnapshotService(store, provider, cipher, undefined, monzo, endute),
    isDatabaseReady: async () => {
      try {
        return (
          (await database.send(new DescribeTableCommand({ TableName: config.DYNAMODB_TABLE })))
            .Table?.TableStatus === "ACTIVE"
        );
      } catch {
        return false;
      }
    },
  });
  return {
    config,
    store,
    analysis,
    auth,
    router,
    handleAuth: createAuthRequestHandler(auth, config.APP_ORIGIN, monzo),
  };
}
let runtime: ReturnType<typeof initialize> | undefined;
export async function handler(event: APIGatewayProxyEventV2) {
  try {
    runtime ??= initialize().catch((error: unknown) => {
      runtime = undefined;
      throw error;
    });
    const { config, auth, router, handleAuth } = await runtime;
    const request = gatewayRequest(event, config.APP_ORIGIN);
    const authResponse = await handleAuth(request);
    if (authResponse) return gatewayResponse(authResponse);
    if (!event.rawPath.startsWith("/api/trpc/"))
      return gatewayResponse(new Response(null, { status: 404 }));
    return gatewayResponse(
      await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router,
        createContext: async ({ resHeaders }) => {
          const token = readCookies(request.headers.get("cookie") ?? undefined)[sessionCookie];
          const authenticated = await auth.authenticate(
            token,
            request.headers.get("x-wealth-activity") === "foreground",
          );
          if (token)
            resHeaders.append(
              "Set-Cookie",
              formatCookie(
                sessionCookie,
                authenticated ? token : "",
                authenticated ? authenticated.expiresAt - Math.floor(Date.now() / 1000) : 0,
                true,
              ),
            );
          return {
            user: authenticated
              ? { userId: authenticated.userId, profile: authenticated.profile }
              : null,
            sessionHash: hash(token ?? ""),
            trustedOrigin: request.headers.get("origin") === config.APP_ORIGIN,
          };
        },
      }),
    );
  } catch {
    console.error("API request failed", { requestId: event.requestContext.requestId });
    return gatewayResponse(
      Response.json({ error: "Service temporarily unavailable." }, { status: 503 }),
    );
  }
}

// This handler is invoked through IAM by the scheduler, never through API Gateway.
export async function syncHandler(event: unknown) {
  runtime ??= initialize().catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  const { store, analysis } = await runtime;
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) throw new Error("Transaction worker function name is missing.");
  const lambda = new LambdaClient({});
  await runEnduteSchedule(event, store.transactions, analysis, async (payload) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  });
}
