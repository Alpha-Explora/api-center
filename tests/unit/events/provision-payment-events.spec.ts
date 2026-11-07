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
    audience: "https://alphaci-be-test-abc.a.run.app/payment-events",
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
    expect(plan.audience).toBe("https://alphaci-be-test-abc.a.run.app/payment-events");
    expect(flatCommands).toEqual(expect.arrayContaining([
      "--max-delivery-attempts=20",
      "--push-auth-service-account=apicenter-pay-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com",
      "--project=alphaci-20260629",
      "--push-auth-token-audience=https://alphaci-be-test-abc.a.run.app/payment-events",
      "--role=roles/run.invoker",
    ]));
    expect(plan.policy.conditions[0].conditionThreshold.filter).toContain(
      "subscription_id=\"apicenter.payment-events.test.dead-letter.subscription\"",
    );
  });

  it("allows HTTPS consumers outside Cloud Run and defaults their OIDC audience to the endpoint", () => {
    const plan = buildPlan({
      ...input,
      endpoint: "https://hooks.example.org/apicenter/payment-events",
      cloudRunServiceName: undefined,
      audience: undefined,
    });
    const flatCommands = plan.commands.flat();
    expect(plan.audience).toBe("https://hooks.example.org/apicenter/payment-events");
    expect(flatCommands).toContain("--push-auth-token-audience=https://hooks.example.org/apicenter/payment-events");
    expect(flatCommands).not.toContain("roles/run.invoker");
    expect(() => validateEndpoint("http://hooks.example.org/events", "test")).toThrow("HTTPS");
    expect(() => validateEndpoint("https://hooks-test.example.org/events?token=x", "test")).toThrow("query or fragment");
    expect(() => validateEndpoint("https://hooks-live.example.org/events", "test")).toThrow("live");
    expect(() => buildPlan({ ...input, cloudRunServiceName: undefined })).toThrow("--cloud-run-service-name");
  });

  it("validates an explicit OIDC audience and supports Cloud Run custom domains", () => {
    expect(() => buildPlan({ ...input, audience: "http://consumer.example.org" })).toThrow("OIDC audience must use HTTPS");
    expect(() => buildPlan({ ...input, audience: "https://user:pass@consumer.example.org" })).toThrow("credentials");
    expect(() => buildPlan({ ...input, audience: "https://consumer.example.org?token=x" })).toThrow("query or fragment");

    const plan = buildPlan({
      ...input,
      endpoint: "https://events.example.org/apicenter",
      audience: "https://events.example.org",
    });
    expect(plan.commands.flat()).toContain("--role=roles/run.invoker");
  });
});
