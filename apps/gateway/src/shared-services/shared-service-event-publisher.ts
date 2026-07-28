import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  SHARED_SERVICE_EVENT_TOPICS,
  SharedServiceEventTopicId,
} from "../kafka/topics";
import { KafkaService } from "../kafka/kafka.service";
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

@Injectable()
export class SharedServiceEventPublisher {
  constructor(private readonly kafka: KafkaService) {}

  publishSharedServiceCall(input: SharedServiceCallInput): void {
    if (!isSharedServiceEventTopicId(input.sharedServiceId)) {
      return;
    }

    assertNoPayloadEnvironmentOverride(input.environment, input.requestBody);
    assertNoPayloadEnvironmentOverride(input.environment, input.responseBody);

    const { request, response, redactions } = sanitizeSharedServiceEventInput({
      sharedServiceId: input.sharedServiceId,
      route: input.route,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
    });

    this.kafka.publishNonBlocking(
      SHARED_SERVICE_EVENT_TOPICS[input.sharedServiceId],
      {
        eventId: randomUUID(),
        eventType: `shared.${input.sharedServiceId}.call`,
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
      },
      {
        key: `${input.tribeId}:${input.environment}:${input.sharedServiceId}`,
        context: "SharedServiceEventPublisher",
      },
    );
  }
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

function isSharedServiceEventTopicId(
  value: string,
): value is SharedServiceEventTopicId {
  return Object.prototype.hasOwnProperty.call(
    SHARED_SERVICE_EVENT_TOPICS,
    value,
  );
}