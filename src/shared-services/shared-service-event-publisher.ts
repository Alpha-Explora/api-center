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
  const subscriptionId =
    typeof response.subscriptionId === "string"
      ? response.subscriptionId
      : undefined;
  const invoiceId =
    typeof response.invoiceId === "string" ? response.invoiceId : undefined;
  const refundId =
    typeof response.refundId === "string" ? response.refundId : undefined;

  if (
    !status ||
    (!checkoutId && !paymentId && !subscriptionId && !invoiceId && !refundId)
  ) {
    return undefined;
  }

  return {
    eventType: paymentLifecycleEventType(status, {
      checkoutId,
      paymentId,
      subscriptionId,
      invoiceId,
      refundId,
    }),
    ...(checkoutId && { checkoutId }),
    ...(paymentId && { paymentId }),
    ...(subscriptionId && { subscriptionId }),
    ...(invoiceId && { invoiceId }),
    ...(refundId && { refundId }),
    ...(typeof response.customerId === "string" && {
      customerId: response.customerId,
    }),
    ...(typeof response.priceId === "string" && {
      priceId: response.priceId,
    }),
    ...(typeof response.referenceId === "string" && {
      referenceId: response.referenceId,
    }),
    status,
    ...(typeof response.amount === "number" && {
      amount: response.amount,
    }),
    ...(typeof response.currency === "string" && {
      currency: response.currency,
    }),
    ...(typeof response.provider === "string" && {
      provider: response.provider,
    }),
    ...(typeof response.providerMode === "string" && {
      providerMode: response.providerMode,
    }),
  };
}

function paymentLifecycleEventType(
  status: string,
  ids: {
    checkoutId?: string;
    paymentId?: string;
    subscriptionId?: string;
    invoiceId?: string;
    refundId?: string;
  },
) {
  if (ids.checkoutId) {
    if (status === "paid") return "payment.checkout.paid";
    if (status === "failed") return "payment.checkout.failed";
    if (status === "cancelled") return "payment.checkout.cancelled";
    if (status === "expired") return "payment.checkout.expired";
    return "payment.checkout.created";
  }

  if (ids.subscriptionId) {
    if (status === "active") return "payment.subscription.active";
    if (status === "past_due") return "payment.subscription.past_due";
    if (status === "paused") return "payment.subscription.paused";
    if (status === "cancelled") return "payment.subscription.cancelled";
    return "payment.subscription.created";
  }

  if (ids.invoiceId) {
    if (status === "paid") return "payment.invoice.paid";
    if (status === "failed") return "payment.invoice.failed";
    return "payment.invoice.created";
  }

  if (ids.refundId) {
    return "payment.refund.updated";
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
