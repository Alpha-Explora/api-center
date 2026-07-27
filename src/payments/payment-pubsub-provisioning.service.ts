import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PubSub, Subscription } from "@google-cloud/pubsub";
import { z } from "zod";
import {
  PaymentPubSubIamProvisioningService,
  type PaymentPubSubIamResult,
} from "./payment-pubsub-iam-provisioning.service";

const ConsumerDeliveryInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  pushEndpoint: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "pushEndpoint must use HTTPS"),
  oidcAudience: z.string().url().optional(),
  deliveryServiceAccountEmail: z.string().email(),
  endpointEnvironment: z.enum(["test", "live"]).optional(),
  consumerProjectId: z.string().trim().min(1).optional(),
  cloudRunRegion: z.string().trim().min(1).optional(),
  cloudRunServiceName: z.string().trim().min(1).optional(),
});

export type ConsumerDeliveryInput = z.infer<typeof ConsumerDeliveryInput>;

export type PaymentEventProvisioningResult = {
  projectId: string;
  environment: "test" | "live";
  topicName: string;
  deadLetterTopicName: string;
  deadLetterSubscriptionName: string;
  subscriptionName: string;
  filter: string;
  maxDeliveryAttempts: number;
  monitoringAlertName: string;
  iam: PaymentPubSubIamResult;
};

const RETENTION_DURATION = { seconds: 2678400 };
const MAX_DELIVERY_ATTEMPTS = 20;

@Injectable()
export class PaymentPubSubProvisioningService {
  private pubsub: PubSub | null = null;

  constructor(private readonly iamProvisioning = new PaymentPubSubIamProvisioningService()) {}

  async provision(input: unknown): Promise<PaymentEventProvisioningResult> {
    const delivery = this.parse(input);
    const projectId = process.env.APICENTER_GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
      throw new ServiceUnavailableException("APICENTER_GCP_PROJECT_ID is required for Pub/Sub provisioning");
    }

    const topicName = this.topicName(delivery.environment);
    const deadLetterTopicName = `${topicName}.dead-letter`;
    const deadLetterSubscriptionName = `${deadLetterTopicName}.subscription`;
    const subscriptionName = `${topicName}.${delivery.consumerServiceId}`;
    const filter = `attributes.consumerServiceId = "${delivery.consumerServiceId}"`;

    const pubsub = this.client(projectId);
    const topic = pubsub.topic(topicName);
    const deadLetterTopic = pubsub.topic(deadLetterTopicName);
    await this.ensureTopic(topic);
    await this.ensureTopic(deadLetterTopic);
    await topic.setMetadata({ messageRetentionDuration: RETENTION_DURATION });
    await deadLetterTopic.setMetadata({ messageRetentionDuration: RETENTION_DURATION });

    const deadLetterSubscription = deadLetterTopic.subscription(deadLetterSubscriptionName);
    await this.ensureSubscription(deadLetterSubscription, {
      ackDeadlineSeconds: 30,
      messageRetentionDuration: RETENTION_DURATION,
    });

    const subscription = topic.subscription(subscriptionName);
    await this.ensureSubscription(subscription, {
      ackDeadlineSeconds: 30,
      filter,
      messageRetentionDuration: RETENTION_DURATION,
      deadLetterPolicy: {
        deadLetterTopic: deadLetterTopic.name,
        maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
      },
      pushConfig: {
        pushEndpoint: delivery.pushEndpoint,
        oidcToken: {
          serviceAccountEmail: delivery.deliveryServiceAccountEmail,
          audience: delivery.oidcAudience || delivery.pushEndpoint,
        },
      },
    });

    const iam = await this.iamProvisioning.provision({
      projectId,
      topicName,
      deadLetterTopicName,
      subscriptionName,
      deliveryServiceAccountEmail: delivery.deliveryServiceAccountEmail,
      consumerProjectId: delivery.consumerProjectId || projectId,
      cloudRunRegion: delivery.cloudRunRegion || "asia-southeast1",
      cloudRunServiceName: delivery.cloudRunServiceName || this.serviceNameFromEndpoint(delivery.pushEndpoint),
    });

    return {
      projectId,
      environment: delivery.environment,
      topicName,
      deadLetterTopicName,
      deadLetterSubscriptionName,
      subscriptionName,
      filter,
      maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
      monitoringAlertName: `${subscriptionName}.delivery-failures`,
      iam,
    };
  }

  private async ensureTopic(topic: ReturnType<PubSub["topic"]>): Promise<void> {
    try {
      await topic.create();
    } catch (error) {
      if (!this.alreadyExists(error)) throw error;
    }
  }

  private async ensureSubscription(
    subscription: Subscription,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await subscription.create(metadata as never);
    } catch (error) {
      if (!this.alreadyExists(error)) throw error;
      await subscription.setMetadata(metadata as never);
    }
  }

  private client(projectId: string): PubSub {
    if (!this.pubsub) this.pubsub = new PubSub({ projectId });
    return this.pubsub;
  }

  private topicName(environment: "test" | "live"): string {
    const configured =
      environment === "live"
        ? process.env.APICENTER_PAYMENT_EVENTS_TOPIC_LIVE
        : process.env.APICENTER_PAYMENT_EVENTS_TOPIC_TEST;
    return configured || `apicenter.payment-events.${environment}`;
  }

  private parse(input: unknown): ConsumerDeliveryInput {
    const result = ConsumerDeliveryInput.safeParse(input);
    if (!result.success) {
      const error = new Error("Invalid payment event consumer delivery configuration");
      Object.assign(error, { status: 400, details: result.error.issues });
      throw error;
    }

    const delivery = result.data;
    if (delivery.endpointEnvironment && delivery.endpointEnvironment !== delivery.environment) {
      const error = new Error("pushEndpoint environment does not match the requested payment event environment");
      Object.assign(error, { status: 400, details: [{ path: ["endpointEnvironment"], message: "environment mismatch" }] });
      throw error;
    }

    const hostname = new URL(delivery.pushEndpoint).hostname;
    if (!hostname.endsWith(".run.app")) {
      const error = new Error("pushEndpoint must be a Cloud Run run.app URL");
      Object.assign(error, { status: 400, details: [{ path: ["pushEndpoint"], message: "Cloud Run run.app URL required" }] });
      throw error;
    }

    return delivery;
  }

  private serviceNameFromEndpoint(endpoint: string): string {
    const host = new URL(endpoint).hostname;
    return host.split("-")[0] || "consumer";
  }

  private alreadyExists(error: unknown): boolean {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    return code === "6" || code === "ALREADY_EXISTS";
  }
}