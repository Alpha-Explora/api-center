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
        ...(input.sharedServiceId === "payment" && {
          lifecycle: buildPaymentLifecycle(response),
        }),
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

function buildPaymentLifecycle(
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const status = typeof response.status === "string" ? response.status : "";
  const checkoutId =
    typeof response.checkoutId === "string" ? response.checkoutId : undefined;
  const paymentId =
    typeof response.paymentId === "string" ? response.paymentId : undefined;

  if (!status || (!checkoutId && !paymentId)) {
    return undefined;
  }

  return {
    eventType: paymentLifecycleEventType(status, Boolean(checkoutId)),
    ...(checkoutId && { checkoutId }),
    ...(paymentId && { paymentId }),
    status,
    ...(typeof response.provider === "string" && {
      provider: response.provider,
    }),
  };
}

function paymentLifecycleEventType(status: string, hasCheckoutId: boolean) {
  if (hasCheckoutId) {
    if (status === "paid") return "payment.checkout.paid";
    if (status === "failed") return "payment.checkout.failed";
    if (status === "cancelled") return "payment.checkout.cancelled";
    if (status === "expired") return "payment.checkout.expired";
    return "payment.checkout.created";
  }

  if (status === "refunded" || status === "partially_refunded") {
    return "payment.refunded";
  }

  return "payment.provider_event.received";
}

function isSharedServiceEventTopicId(
  value: string,
): value is SharedServiceEventTopicId {
  return Object.prototype.hasOwnProperty.call(
    SHARED_SERVICE_EVENT_TOPICS,
    value,
  );
}
