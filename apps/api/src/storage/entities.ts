import { Entity, CustomAttributeType, type CustomAttributeTypeName } from "electrodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface Profile {
  readonly email: string;
  readonly name: string;
}
export function recordEntity<T extends object>(
  name: string,
  client: DynamoDBDocumentClient,
  table: string,
) {
  return new Entity(
    {
      model: { entity: name, service: "wealth", version: "1" },
      attributes: {
        owner: { type: "string", required: true },
        id: { type: "string", required: true },
        version: { type: "number", required: true },
        data: {
          type: CustomAttributeType<object>("any") as CustomAttributeTypeName<T>,
          required: true,
        },
        createdAt: { type: "string", required: true },
        updatedAt: { type: "string", required: true },
      },
      indexes: {
        primary: {
          pk: { field: "pk", composite: ["owner"] },
          sk: { field: "sk", composite: ["id"] },
        },
      },
    },
    { client, table },
  );
}
export function authEntities(client: DynamoDBDocumentClient, table: string) {
  const sessions = new Entity(
    {
      model: { entity: "session", service: "wealth", version: "1" },
      attributes: {
        tokenHash: { type: "string", required: true },
        userId: { type: "string", required: true },
        expiresAt: { type: "number", required: true },
        createdAt: { type: "string", required: true },
      },
      indexes: {
        primary: {
          pk: { field: "pk", composite: ["tokenHash"] },
          sk: { field: "sk", composite: [] },
        },
      },
    },
    { client, table },
  );
  const attempts = new Entity(
    {
      model: { entity: "oauth", service: "wealth", version: "1" },
      attributes: {
        stateHash: { type: "string", required: true },
        bindingHash: { type: "string", required: true },
        nonce: { type: "string", required: true },
        verifier: { type: "string", required: true },
        expiresAt: { type: "number", required: true },
      },
      indexes: {
        primary: {
          pk: { field: "pk", composite: ["stateHash"] },
          sk: { field: "sk", composite: [] },
        },
      },
    },
    { client, table },
  );
  return { sessions, attempts, profiles: recordEntity<Profile>("profile", client, table) };
}

export function monzoAttemptEntity(client: DynamoDBDocumentClient, table: string) {
  return new Entity(
    {
      model: { entity: "monzoOAuth", service: "wealth", version: "1" },
      attributes: {
        stateHash: { type: "string", required: true },
        userId: { type: "string", required: true },
        sessionHash: { type: "string", required: true },
        encryptedCredentials: { type: "string", required: true },
        connectionId: { type: "string" },
        expiresAt: { type: "number", required: true },
      },
      indexes: {
        primary: {
          pk: { field: "pk", composite: ["stateHash"] },
          sk: { field: "sk", composite: [] },
        },
      },
    },
    { client, table },
  );
}

type Config = { client: DynamoDBDocumentClient; table: string };
const required = { type: "string", required: true } as const;
const nullable = { type: "any" } as const;
const model = <const E extends string>(entity: E) =>
  ({ entity, service: "wealth", version: "1" }) as const;
const ownerKeys = <const S extends readonly string[]>(sk: S) =>
  ({
    primary: { pk: { field: "pk", composite: ["owner"] }, sk: { field: "sk", composite: sk } },
  }) as const;
// Job and capacity registries share one partition so dispatchers can list every owner.
const globalKeys = <const S extends readonly string[]>(sk: S) =>
  ({
    primary: { pk: { field: "pk", composite: [] }, sk: { field: "sk", composite: sk } },
  }) as const;
export function analysisEntities({ client, table }: Config) {
  const config = { client, table };
  return {
    enduteJob: new Entity(
      {
        model: model("enduteJob"),
        attributes: { owner: required },
        indexes: globalKeys(["owner"]),
      },
      config,
    ),
    enduteSync: new Entity(
      {
        model: model("enduteSync"),
        attributes: {
          owner: required,
          data: { type: CustomAttributeType<Record<string, unknown>>("any") },
          leaseUntil: { type: "number" },
          leaseToken: nullable,
        },
        indexes: ownerKeys([]),
      },
      config,
    ),
    enduteTransaction: new Entity(
      {
        model: model("enduteTransaction"),
        attributes: {
          owner: required,
          bookingDate: required,
          id: required,
          data: { type: CustomAttributeType<object>("any"), required: true },
        },
        indexes: ownerKeys(["bookingDate", "id"]),
      },
      config,
    ),
    enduteTransactionId: new Entity(
      {
        model: model("enduteTransactionId"),
        attributes: {
          owner: required,
          id: required,
          bookingDate: required,
          digest: required,
          excluded: { type: "boolean" },
        },
        indexes: ownerKeys(["id"]),
      },
      config,
    ),
    categoryConfig: new Entity(
      {
        model: model("categoryConfig"),
        attributes: {
          owner: required,
          version: { type: "number", required: true },
          categories: {
            type: CustomAttributeType<{ id: string; name: string }[]>("any"),
            required: true,
          },
          generation: required,
        },
        indexes: ownerKeys([]),
      },
      config,
    ),
    categoryRebuild: new Entity(
      {
        model: model("categoryRebuild"),
        attributes: {
          owner: required,
          generation: required,
          cursor: nullable,
          done: { type: "boolean", required: true },
        },
        indexes: ownerKeys([]),
      },
      config,
    ),
    categoryPending: new Entity(
      {
        model: model("categoryPending"),
        attributes: {
          owner: required,
          id: required,
          bookingDate: required,
          digest: required,
          attempts: { type: "number", required: true },
          generation: { type: "string" },
        },
        indexes: ownerKeys(["id"]),
      },
      config,
    ),
    categoryResult: new Entity(
      {
        model: model("categoryResult"),
        attributes: {
          owner: required,
          id: required,
          categoryId: nullable,
          source: { type: ["manual", "gemini"] as const, required: true },
          version: { type: "number", required: true },
          generation: required,
          digest: required,
          model: nullable,
          updatedAt: required,
          failed: { type: "boolean" },
        },
        indexes: ownerKeys(["id"]),
      },
      config,
    ),
    categoryBatch: new Entity(
      {
        model: model("categoryBatch"),
        attributes: {
          owner: required,
          id: required,
          displayName: required,
          providerName: nullable,
          phase: { type: ["prepared", "submitted", "uncertain"] as const, required: true },
          version: { type: "number", required: true },
          generation: required,
          model: required,
          createdAt: required,
          items: {
            type: CustomAttributeType<
              {
                id: string;
                bookingDate: string;
                digest: string;
                attempts: number;
                generation?: string;
              }[]
            >("any"),
            required: true,
          },
          nextIndex: { type: "number" },
        },
        indexes: ownerKeys(["id"]),
      },
      config,
    ),
    categoryActive: new Entity(
      {
        model: model("categoryActive"),
        attributes: { batchId: required, owner: required },
        indexes: globalKeys(["batchId"]),
      },
      config,
    ),
    categoryWork: new Entity(
      {
        model: model("categoryWork"),
        attributes: {
          owner: required,
          leaseUntil: { type: "number" },
          token: { type: "string" },
          error: nullable,
          lastRunAt: { type: "string" },
          retryAfter: { type: "number" },
        },
        indexes: ownerKeys([]),
      },
      config,
    ),
    categoryJob: new Entity(
      {
        model: model("categoryJob"),
        attributes: { owner: required },
        indexes: globalKeys(["owner"]),
      },
      config,
    ),
  };
}
