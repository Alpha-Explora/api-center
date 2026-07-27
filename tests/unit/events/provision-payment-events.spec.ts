const { buildPlan, validateEndpoint } = require("../../../scripts/gcp/provision-payment-events.js");

describe("payment event provisioning plan", () => {
  const input = {
    project: "apicenter-alpha-20260623",
    consumerProject: "alphaci-20260629",
    region: "asia-southeast1",
    environment: "test" as const,
    consumerServiceId: "alphaci-backend",
    endpoint: "https://alphaci-be-test-abc.a.run.app/payment-events",
    cloudRunServiceName: "alphaci-be-test",
    deliveryServiceAccount: "apicenter-payment-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com",
    apply: false,
  };

  it("builds canonical filtered OIDC and dead-letter resources", () => {
    const plan = buildPlan(input, "123456789");

    expect(plan.names).toEqual({
      topic: "apicenter.payment-events.test",
      deadLetterTopic: "apicenter.payment-events.test.dead-letter",
      deadLetterSubscription: "apicenter.payment-events.test.dead-letter.subscription",
      subscription: "apicenter.payment-events.test.alphaci-backend",
      alertPolicy: "apicenter.payment-events.test.alphaci-backend.delivery-failures",
    });
    expect(plan.commands).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["--message-filter=attributes.consumerServiceId = \"alphaci-backend\""]),
        expect.arrayContaining(["--max-delivery-attempts=20"]),
        expect.arrayContaining(["--push-auth-service-account=apicenter-payment-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com"]),
        expect.arrayContaining(["--role=roles/run.invoker"]),
      ]),
    );
    expect(plan.policy.conditions[0].conditionThreshold.filter).toContain(
      "subscription_id=\"apicenter.payment-events.test.dead-letter.subscription\"",
    );
  });

  it("rejects non-Cloud-Run or cross-environment endpoints", () => {
    expect(() => validateEndpoint("http://alphaci-be-test-abc.a.run.app", "test")).toThrow("HTTPS");
    expect(() => validateEndpoint("https://example.com/events", "test")).toThrow("run.app");
    expect(() => validateEndpoint("https://alphaci-be-live-abc.a.run.app", "test")).toThrow("live");
  });
});
