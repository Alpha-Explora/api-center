import { PaymentPubSubProvisioningService } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";

describe("PaymentPubSubProvisioningService", () => {
  const originalProject = process.env.GCP_PROJECT_ID;

  afterEach(() => {
    if (originalProject === undefined) delete process.env.GCP_PROJECT_ID;
    else process.env.GCP_PROJECT_ID = originalProject;
  });

  it("updates an existing subscription without touching its immutable filter", async () => {
    process.env.GCP_PROJECT_ID = "apicenter-test";
    const exists = Object.assign(new Error("exists"), { code: 6 });
    const existing = { create: jest.fn().mockRejectedValue(exists), setMetadata: jest.fn().mockResolvedValue(undefined) };
    const topic = (name: string) => ({
      name,
      create: jest.fn().mockRejectedValue(exists),
      setMetadata: jest.fn().mockResolvedValue(undefined),
      subscription: jest.fn(() => existing),
    });
    const service = new PaymentPubSubProvisioningService();
    (service as unknown as { pubsub: { topic: typeof topic } }).pubsub = { topic };

    await service.provision({
      ownerTribeId: "org",
      consumerServiceId: "app_aaaaaaaaaaaaaaaaaaaaaaaa",
      environment: "test",
      pushEndpoint: "https://apicenter-webhooks-live-1.asia-southeast1.run.app/deliveries/dst_bbbbbbbbbbbbbbbbbbbbbbbb",
      deliveryServiceAccountEmail: "push@apicenter-test.iam.gserviceaccount.com",
    });

    const updates = existing.setMetadata.mock.calls.map(([metadata]) => metadata);
    expect(updates.length).toBeGreaterThan(0);
    for (const metadata of updates) expect(metadata).not.toHaveProperty("filter");
    expect(updates).toContainEqual(
      expect.objectContaining({
        pushConfig: expect.objectContaining({
          pushEndpoint: "https://apicenter-webhooks-live-1.asia-southeast1.run.app/deliveries/dst_bbbbbbbbbbbbbbbbbbbbbbbb",
        }),
      }),
    );
  });

  it("provisions an environment-scoped filtered OIDC subscription", async () => {
    process.env.GCP_PROJECT_ID = "apicenter-test";
    const subscriptions = new Map<string, { create: jest.Mock; setMetadata: jest.Mock }>();
    const topics = new Map<string, { name: string; create: jest.Mock; setMetadata: jest.Mock; subscription: jest.Mock }>();
    const topic = (name: string) => {
      if (!topics.has(name)) {
        topics.set(name, {
          name,
          create: jest.fn().mockResolvedValue(undefined),
          setMetadata: jest.fn().mockResolvedValue(undefined),
          subscription: jest.fn((subscriptionName: string) => {
            if (!subscriptions.has(subscriptionName)) {
              subscriptions.set(subscriptionName, {
                create: jest.fn().mockResolvedValue(undefined),
                setMetadata: jest.fn().mockResolvedValue(undefined),
              });
            }
            return subscriptions.get(subscriptionName);
          }),
        });
      }
      return topics.get(name);
    };
    const service = new PaymentPubSubProvisioningService();
    (service as unknown as { pubsub: { topic: typeof topic } }).pubsub = { topic };

    await expect(
      service.provision({
        ownerTribeId: "alphaci",
        consumerServiceId: "alphaci-backend",
        environment: "test",
        pushEndpoint: "https://alphaci-be-test-abc.a.run.app/internal/apicenter/payment-events",
        oidcAudience: "https://alphaci-be-test-abc.a.run.app",
        deliveryServiceAccountEmail: "delivery@apicenter-test.iam.gserviceaccount.com",
      }),
    ).resolves.toMatchObject({
      projectId: "apicenter-test",
      topicName: "apicenter.payment-events.test",
      deadLetterTopicName: "apicenter.payment-events.test.dead-letter",
      deadLetterSubscriptionName: "apicenter.payment-events.test.dead-letter.subscription",
      subscriptionName: "apicenter.payment-events.test.alphaci-backend",
      maxDeliveryAttempts: 20,
    });

    const provisionedTopic = topics.get("apicenter.payment-events.test");
    expect(provisionedTopic).toBeDefined();
    expect(provisionedTopic!.setMetadata).toHaveBeenCalledWith({
      messageRetentionDuration: { seconds: 2678400 },
    });
    const deadLetterSubscription = subscriptions.get("apicenter.payment-events.test.dead-letter.subscription");
    expect(deadLetterSubscription).toBeDefined();
    const subscription = subscriptions.get("apicenter.payment-events.test.alphaci-backend");
    expect(subscription).toBeDefined();
    expect(subscription!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ackDeadlineSeconds: 30,
        filter: 'attributes.consumerServiceId = "alphaci-backend"',
        deadLetterPolicy: expect.objectContaining({ maxDeliveryAttempts: 20 }),
        pushConfig: expect.objectContaining({
          pushEndpoint: "https://alphaci-be-test-abc.a.run.app/internal/apicenter/payment-events",
          oidcToken: expect.objectContaining({
            serviceAccountEmail: "delivery@apicenter-test.iam.gserviceaccount.com",
          }),
        }),
      }),
    );
  });

  it("rejects non-HTTPS delivery endpoints", async () => {
    const service = new PaymentPubSubProvisioningService();
    await expect(
      service.provision({
        ownerTribeId: "alphaci",
        consumerServiceId: "alphaci-backend",
        environment: "test",
        pushEndpoint: "http://localhost:4000/events",
      }),
    ).rejects.toMatchObject({ details: expect.any(Array) });
  });
});
