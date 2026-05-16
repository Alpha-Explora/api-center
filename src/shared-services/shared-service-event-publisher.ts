import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  SHARED_SERVICE_EVENT_TOPICS,
  SharedServiceEventTopicId,
} from "../kafka/topics";
import { KafkaService } from "../kafka/kafka.service";
import { sanitizeSharedServiceEventInput } from "./shared-service-event-sanitizer";

type SharedServiceCallInput = {
  tribeId: string;
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
        key: `${input.tribeId}:${input.sharedServiceId}`,
        context: "SharedServiceEventPublisher",
      },
    );
  }
}

function isSharedServiceEventTopicId(
  value: string,
): value is SharedServiceEventTopicId {
  return Object.prototype.hasOwnProperty.call(
    SHARED_SERVICE_EVENT_TOPICS,
    value,
  );
}
