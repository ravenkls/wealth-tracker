import { z } from "zod";

const port = z.coerce.number().int().min(1024).max(65535);
const configSchema = z.object({
  WEB_PORT: port.default(5173),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LOCAL_ENCRYPTION_KEY: z.string().optional(),
  API_PORT: port.default(3001),
  DYNAMODB_PORT: port.default(8000),
  DYNAMODB_TABLE: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{3,255}$/)
    .default("wealth-tracker-local"),
});

export function readLocalConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === "production") throw new Error("The local API cannot run in production.");
  const config = configSchema.parse(env);
  return {
    apiPort: config.API_PORT,
    appOrigin: `http://localhost:${config.WEB_PORT}`,
    googleClientId: config.GOOGLE_CLIENT_ID,
    googleClientSecret: config.GOOGLE_CLIENT_SECRET,
    encryptionKey: config.LOCAL_ENCRYPTION_KEY,
    tableName: config.DYNAMODB_TABLE,
    databaseEndpoint: `http://127.0.0.1:${config.DYNAMODB_PORT}`,
  };
}
