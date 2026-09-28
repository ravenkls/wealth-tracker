import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

export function createLocalDatabase(endpoint: string) {
  const url = new URL(endpoint);
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || url.username || url.password) {
    throw new Error("Local database operations require a loopback HTTP endpoint.");
  }
  return new DynamoDBClient({
    endpoint,
    region: "eu-west-2",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
}

export async function isTableReady(client: DynamoDBClient, tableName: string): Promise<boolean> {
  try {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }), {
      abortSignal: AbortSignal.timeout(2000),
    });
    return result.Table?.TableStatus === "ACTIVE";
  } catch {
    return false;
  }
}
