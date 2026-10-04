import { PaymentPubSubIamProvisioningService, type IamRequestClient } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-iam-provisioning.service";

describe("PaymentPubSubIamProvisioningService", () => {
  const originalFlag = process.env.PAYMENT_PUBSUB_IAM_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.PAYMENT_PUBSUB_IAM_ENABLED;
    else process.env.PAYMENT_PUBSUB_IAM_ENABLED = originalFlag;
  });

  it("merges idempotent IAM bindings without dropping existing members", async () => {
    process.env.PAYMENT_PUBSUB_IAM_ENABLED = "true";
    const calls: Array<{ url: string; method: string; data?: unknown }> = [];
    const client: IamRequestClient = {
      request: jest.fn(async (options: { url: string; method: "GET" | "POST"; data?: unknown }) => {
        calls.push(options);
        if (options.url.includes("cloudresourcemanager.googleapis.com")) {
          return { data: { projectNumber: "123456789" } as never };
        }
        if (options.method === "GET") {
          return {
            data: {
              version: 3,
              etag: "etag-1",
              bindings: [{ role: "roles/pubsub.publisher", members: ["serviceAccount:existing@example.iam.gserviceaccount.com"] }],
            } as never,
          };
        }
        return { data: {} as never };
      }),
    };

    const result = await new PaymentPubSubIamProvisioningService(client).provision({
      projectId: "apicenter-test",
      topicName: "payments.test",
      deadLetterTopicName: "payments.test.dead-letter",
      subscriptionName: "payments.test.alphaci",
      deliveryServiceAccountEmail: "delivery@apicenter-test.iam.gserviceaccount.com",
      consumerProjectId: "alphaci-test",
      cloudRunRegion: "asia-southeast1",
      cloudRunServiceName: "alphaci-be-test",
    });

    expect(result).toMatchObject({ status: "applied", projectNumber: "123456789" });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(4);
    const firstPolicy = calls.find((call) => call.method === "POST")?.data as { policy: { bindings: Array<{ role: string; members: string[] }> } };
    expect(firstPolicy.policy.bindings[0].members).toEqual([
      "serviceAccount:existing@example.iam.gserviceaccount.com",
      "serviceAccount:service-123456789@gcp-sa-pubsub.iam.gserviceaccount.com",
    ]);
  });

  it("skips all Google calls when the feature flag is disabled", async () => {
    delete process.env.PAYMENT_PUBSUB_IAM_ENABLED;
    const client: IamRequestClient = { request: jest.fn() };
    await expect(new PaymentPubSubIamProvisioningService(client).provision({})).resolves.toEqual({ status: "skipped", reason: "disabled" });
    expect(client.request).not.toHaveBeenCalled();
  });
});