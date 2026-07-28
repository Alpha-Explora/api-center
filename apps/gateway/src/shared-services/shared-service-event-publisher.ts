import { PubSub } from "@google-cloud/pubsub";
import { Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ApicenterRuntimeEnvironment } from "../types";
import { sanitizeSharedServiceEventInput } from "./shared-service-event-sanitizer";

type SharedServiceCallInput = {
  tribeId: string;
  environment: ApicenterRuntimeEnvironment;
  sharedServiceId: string;
  route: string;
  method: string;
  statusCode: number;
  ok: boolean;
  latencyMs: number;
  correlationId?: string;
  requestBody?: unknown;
  responseBody?: unknown;
};

type PubSubLike = {
  topic(name: string): {
    publishMessage(message: {
      json: Record<string, unknown>;
      attributes: Record<string, string>;
    }): Promise<string>;
  };
};

const SHARED_SERVICE_EVENT_IDS = new Set([
  "sms",
  "email",
  "payment",
  "otp",
  "geo",
  "gauth",
]);

@Injectable()
export class SharedServiceEventPublisher {
  constructor(@Optional() private readonly pubsub?: PubSubLike) {}

  publishSharedServiceCall(input: SharedServiceCallInput): void {
    if (!SHARED_SERVICE_EVENT_IDS.has(input.sharedServiceId)) return;

    assertNoPayloadEnvironmentOverride(input.environment, input.requestBody);
    assertNoPayloadEnvironmentOverride(input.environment, input.responseBody);

    const { request, response, redactions } = sanitizeSharedServiceEventInput({
      sharedServiceId: input.sharedServiceId,
      route: input.route,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
    });
    const eventType = `shared.${input.sharedServiceId}.call`;
    const event = {
      eventId: randomUUID(),
      eventType,
      tribeId: input.tribeId,
      environment: input.environment,
      sharedServiceId: input.sharedServiceId,
      route: input.route,
      method: input.method,
      statusCode: input.statusCode,
      ok: input.ok,
      latencyMs: input.latencyMs,
      ...(input.correlationId && { correlationId: input.correlationId }),
      request,
      response,
      redactions,
      timestamp: new Date().toISOString(),
    } satisfies Record<string, unknown>;

    if (process.env.SHARED_SERVICE_PUBSUB_ENABLED !== "true") return;

    const client =
      this.pubsub ??
      new PubSub({
        projectId:
          process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
      });
    const topic = client.topic(sharedServiceEventTopicName(input.environment));
    const attributes = {
      eventType,
      environment: input.environment,
      sharedServiceId: input.sharedServiceId,
      tribeId: input.tribeId,
      ...(input.correlationId && { correlationId: input.correlationId }),
    };

    void topic.publishMessage({ json: event, attributes }).catch((error) => {
      console.error("[apicenter] shared-service Pub/Sub publish failed", {
        eventType,
        environment: input.environment,
        sharedServiceId: input.sharedServiceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export function sharedServiceEventTopicName(
  environment: ApicenterRuntimeEnvironment,
): string {
  return (
    process.env[
      `APICENTER_SHARED_SERVICE_EVENTS_TOPIC_${environment.toUpperCase()}`
    ] || `apicenter.shared-service-events.${environment}`
  );
}

function assertNoPayloadEnvironmentOverride(
  expectedEnvironment: ApicenterRuntimeEnvironment,
  value: unknown,
): void {
  const overrides = collectEnvironmentOverrides(value);
  for (const override of overrides) {
    if (override !== expectedEnvironment) {
      throw new Error(
        "Shared-service event payload cannot override APICenter environment",
      );
    }
  }
}

function collectEnvironmentOverrides(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectEnvironmentOverrides);

  const record = value as Record<string, unknown>;
  const overrides: string[] = [];
  for (const [key, fieldValue] of Object.entries(record)) {
    if (isEnvironmentOverrideKey(key) && typeof fieldValue === "string") {
      overrides.push(fieldValue);
      continue;
    }
    overrides.push(...collectEnvironmentOverrides(fieldValue));
  }
  return overrides;
}

function isEnvironmentOverrideKey(key: string): boolean {
  return [
    "environment",
    "targetEnvironment",
    "target_environment",
    "apicenterEnvironment",
    "apicenter_environment",
  ].includes(key);
}
