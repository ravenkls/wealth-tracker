import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  ResourceInUseException,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import { setTimeout } from "node:timers/promises";
import { readLocalConfig } from "./config";
import { createLocalDatabase, isTableReady } from "./database";

const config = readLocalConfig(process.env);
const client = createLocalDatabase(config.databaseEndpoint);
try {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.send(new DescribeTableCommand({ TableName: config.tableName }), {
        abortSignal: AbortSignal.timeout(2000),
      });
      break;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        try {
          await client.send(
            new CreateTableCommand({
              TableName: config.tableName,
              BillingMode: "PAY_PER_REQUEST",
              KeySchema: [
                { AttributeName: "pk", KeyType: "HASH" },
                { AttributeName: "sk", KeyType: "RANGE" },
              ],
              AttributeDefinitions: [
                { AttributeName: "pk", AttributeType: "S" },
                { AttributeName: "sk", AttributeType: "S" },
              ],
            }),
          );
        } catch (createError) {
          if (!(createError instanceof ResourceInUseException)) throw createError;
        }
        break;
      }
      if (attempt >= 20)
        throw new Error(
          "DynamoDB Local is unavailable. Run pnpm db:up and check docker compose logs.",
          { cause: error },
        );
      await setTimeout(500);
    }
  }
  for (let attempt = 0; !(await isTableReady(client, config.tableName)); attempt++) {
    if (attempt >= 20) throw new Error("The local table did not become active.");
    await setTimeout(500);
  }
  const { Table } = await client.send(new DescribeTableCommand({ TableName: config.tableName }));
  if (
    Table?.KeySchema?.find((key) => key.KeyType === "HASH")?.AttributeName !== "pk" ||
    Table.KeySchema.find((key) => key.KeyType === "RANGE")?.AttributeName !== "sk" ||
    Table.AttributeDefinitions?.some(
      (attribute) =>
        ["pk", "sk"].includes(attribute.AttributeName ?? "") && attribute.AttributeType !== "S",
    )
  ) {
    throw new Error("Existing table has incompatible keys. No data was changed.");
  }
  if (Table.BillingModeSummary?.BillingMode !== "PAY_PER_REQUEST") {
    throw new Error(
      "Existing table is not configured for on-demand capacity. No capacity changes were made.",
    );
  }
  const { TimeToLiveDescription: ttl } = await client.send(
    new DescribeTimeToLiveCommand({ TableName: config.tableName }),
  );
  if (ttl?.TimeToLiveStatus === "DISABLED") {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: config.tableName,
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      }),
    );
  } else if (
    ttl?.AttributeName !== "expiresAt" ||
    !["ENABLED", "ENABLING"].includes(ttl.TimeToLiveStatus ?? "")
  ) {
    throw new Error("Existing TTL configuration differs from expiresAt. No TTL changes were made.");
  }
  console.log(`DynamoDB Local ready: ${config.tableName} (pk, sk; expiresAt TTL).`);
} finally {
  client.destroy();
}
