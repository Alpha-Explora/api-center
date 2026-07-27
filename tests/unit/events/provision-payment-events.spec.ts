const { buildPlan, validateEndpoint } = require("../../../scripts/gcp/provision-payment-events.js");

describe("payment event provisioning plan", () => {
  const input = {
    project: "apicenter-alpha-20260623",
    consumerProject: "alphaci-20260629",
    region: "asia-southeast1",
    environment: "test",
    consumerServiceId: "alphaci-backend",
    endpoint: "https://alphaci-be-test-abc.a.run.app/payment-events",
    cloudRunServiceName: "alphaci-be-test",
    deliveryServiceAccount: "apicenter-pay-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com",
    apply: false,
  };

  it("builds canonical filtered OIDC and dead-letter resources", () => {
    const plan = buildPlan(input, "123456789");
    const flatCommands = plan.commands.flat();
    const filterCommand = flatCommands.find((value: unknown) => typeof value === "string" && value.startsWith("--message-filter="));

    expect(plan.names).toEqual({
      topic: "apicenter.payment-events.test",
      deadLetterTopic: "apicenter.payment-events.test.dead-letter",
      deadLetterSubscription: "apicenter.payment-events.test.dead-letter.subscription",
      subscription: "apicenter.payment-events.test.alphaci-backend",
      alertPolicy: "apicenter.payment-events.test.alphaci-backend.delivery-failures",
    });
    expect(filterCommand).toContain("consumerServiceId");
    expect(filterCommand).toContain("alphaci-backend");
    expect(flatCommands).toEqual(expect.arrayContaining([
      "--max-delivery-attempts=20",
      "--push-auth-service-account=apicenter-pay-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com",
      "--project=alphaci-20260629",
      "--role=roles/run.invoker",
    ]));
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