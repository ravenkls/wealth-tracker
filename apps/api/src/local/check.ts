import { readLocalConfig } from "./config";
import { createLocalDatabase, isTableReady } from "./database";
const config = readLocalConfig(process.env);
const database = createLocalDatabase(config.databaseEndpoint);
try {
  if (!(await isTableReady(database, config.tableName))) {
    throw new Error("Local table unavailable. Run pnpm dev:setup.");
  }
  console.log(`Local table ${config.tableName} is ready.`);
} finally {
  database.destroy();
}
