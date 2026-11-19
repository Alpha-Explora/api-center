// The "send test event" payload. It is published to the same payment events topic, with the same
// consumerServiceId attribute, as a real payment event, so the destination's filtered Pub/Sub
// subscription delivers it and the webhooks runtime signs it like any other delivery. It satisfies
// the contract 2.0 envelope, so the SDK's verifyWebhook accepts it as an unrecognized event type.
import { randomBytes } from "node:crypto";
import { PubSub } from "@google-cloud/pubsub";
import { paymentEventTopicName } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";

export const TEST_EVENT_TYPE = "webhook.test";

export interface TestEventTarget {
  destinationId: string;
  environment: "test" | "live";
  /** The resource owner real payment events carry: the legacy owner of a migrated project, else the organization and project. */
  organizationId: string;
  projectId: string;
  applicationId: string;
}

export interface TestEventMessage {
  event: Record<string, unknown> & { eventId: string; eventType: string; occurredAt: string };
  attributes: Record<string, string>;
}

export function buildTestEvent(target: TestEventTarget, now = new Date(), eventId = `evt_${randomBytes(12).toString("hex")}`): TestEventMessage {
  const event = {
    eventId,
    contractVersion: "2.0",
    eventType: TEST_EVENT_TYPE,
    environment: target.environment,
    organizationId: target.organizationId,
    projectId: target.projectId,
    applicationId: target.applicationId,
    referenceId: "webhook-test",
    aggregateType: "webhook_destination",
    aggregateId: target.destinationId,
    aggregateVersion: 1,
    occurredAt: now.toISOString(),
    data: {
      test: true,
      destinationId: target.destinationId,
      message: "A test event sent from the APICenter console. It is not a payment; acknowledge it and take no action.",
    },
  };
  return {
    event,
    attributes: {
      eventId,
      eventType: TEST_EVENT_TYPE,
      contractVersion: "2.0",
      environment: target.environment,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: "1",
      organizationId: target.organizationId,
      projectId: target.projectId,
      applicationId: target.applicationId,
      // The destination's subscription filter: attributes.consumerServiceId = "<applicationId>".
      consumerServiceId: target.applicationId,
      referenceId: event.referenceId,
      test: "true",
    },
  };
}

/** Publishes onto the payment events topic of an environment; returns the Pub/Sub message ID. */
export interface TestEventPublisher {
  publish(environment: "test" | "live", message: TestEventMessage): Promise<string>;
}

export const WEBHOOK_TEST_EVENT_PUBLISHER = Symbol("WEBHOOK_TEST_EVENT_PUBLISHER");

export function createPubSubTestEventPublisher(projectId: string, client: Pick<PubSub, "topic"> = new PubSub({ projectId })): TestEventPublisher {
  return {
    publish: (environment, message) =>
      client.topic(paymentEventTopicName(environment)).publishMessage({ json: message.event, attributes: message.attributes }),
  };
}
