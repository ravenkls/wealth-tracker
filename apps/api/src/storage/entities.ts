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
