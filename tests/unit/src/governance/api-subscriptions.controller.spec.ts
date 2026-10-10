import { ApiSubscriptionsController } from "../../../../apps/gateway/src/domains/governance/api-subscriptions/api-subscriptions.controller";

describe("ApiSubscriptionsController", () => {
  const subscription = {
    id: "subscription-1",
    consumerProjectId: "consumer-project",
    apiServiceId: "owner-api",
    environment: "test",
  };
  const subscriptions = {
    request: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    decide: jest.fn(),
  };
  const registry = {
    get: jest.fn(() => ({ projectId: "owner-project" })),
  };
  const auth = {
    mergeCallerScopes: jest.fn(() => [] as string[]),
  };
  let controller: ApiSubscriptionsController;

  const jwtRequest = (projectId?: string) =>
    ({
      projectId,
      user: { sub: "jwt-user", scopes: [] },
      headers: { "x-apicenter-actor": "spoofed@example.com" },
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.get.mockResolvedValue(subscription);
    controller = new ApiSubscriptionsController(
      subscriptions as never,
      registry as never,
      auth as never,
    );
  });

  it("allows platform admin requests and uses its authenticated actor header", async () => {
    subscriptions.request.mockResolvedValue(subscription);
    await controller.request(
      {
        consumerProjectId: "consumer-project",
        apiServiceId: "owner-api",
        environment: "test",
      },
      {
        platformAdmin: true,
        headers: { "x-apicenter-actor": "admin@example.com" },
      } as never,
    );
    expect(subscriptions.request).toHaveBeenCalledWith(
      "admin@example.com",
      expect.objectContaining({ consumerProjectId: "consumer-project" }),
    );
  });

  it("allows a consumer project JWT to request and list its own subscriptions", async () => {
    await controller.request(
      {
        consumerProjectId: "consumer-project",
        apiServiceId: "owner-api",
        environment: "test",
      },
      jwtRequest("consumer-project"),
    );
    await controller.list(
      "consumer-project",
      undefined,
      undefined,
      jwtRequest("consumer-project"),
    );
    expect(subscriptions.request).toHaveBeenCalledWith(
      "jwt-user",
      expect.anything(),
    );
    expect(subscriptions.list).toHaveBeenCalledWith({
      consumerProjectId: "consumer-project",
      apiServiceId: undefined,
    });
  });

  it("forbids a JWT from accessing another consumer project or API owner's list", async () => {
    await expect(
      controller.request(
        {
          consumerProjectId: "other-project",
          apiServiceId: "owner-api",
          environment: "test",
        },
        jwtRequest("consumer-project"),
      ),
    ).rejects.toThrow();
    await expect(
      controller.list(undefined, "owner-api", undefined, jwtRequest("consumer-project")),
    ).rejects.toThrow();
    expect(subscriptions.request).not.toHaveBeenCalled();
    expect(subscriptions.list).not.toHaveBeenCalled();
  });

  it("limits an unfiltered JWT list to the caller's own project", async () => {
    await controller.list(undefined, undefined, undefined, jwtRequest("consumer-project"));
    expect(subscriptions.list).toHaveBeenCalledWith({
      consumerProjectId: "consumer-project",
      apiServiceId: undefined,
    });
  });

  it("rejects an unfiltered list from a caller without a project", async () => {
    await expect(
      controller.list(undefined, undefined, undefined, jwtRequest(undefined)),
    ).rejects.toThrow();
    expect(subscriptions.list).not.toHaveBeenCalled();
  });

  it("lets a platform admin list every subscription", async () => {
    await controller.list(undefined, undefined, undefined, {
      platformAdmin: true,
      headers: {},
    } as never);
    expect(subscriptions.list).toHaveBeenCalledWith({
      consumerProjectId: undefined,
      apiServiceId: undefined,
    });
  });

  it("allows the API owner to approve and revoke, but not the consumer", async () => {
    await controller.decide(
      "subscription-1",
      "approve",
      { apiServiceId: "owner-api" },
      jwtRequest("owner-project"),
    );
    await controller.decide(
      "subscription-1",
      "revoke",
      { apiServiceId: "owner-api" },
      jwtRequest("owner-project"),
    );
    expect(subscriptions.decide).toHaveBeenNthCalledWith(
      1,
      "subscription-1",
      "jwt-user",
      "approve",
      undefined,
    );
    await expect(
      controller.decide(
        "subscription-1",
        "approve",
        { apiServiceId: "owner-api" },
        jwtRequest("consumer-project"),
      ),
    ).rejects.toThrow();
  });

  it("rejects a decision whose API identity does not match the stored request", async () => {
    await expect(
      controller.decide(
        "subscription-1",
        "approve",
        { apiServiceId: "different-api" },
        jwtRequest("owner-project"),
      ),
    ).rejects.toThrow("API service does not match the subscription request");
    expect(subscriptions.decide).not.toHaveBeenCalled();
  });

  it("does not treat a JWT without project identity as an administrator", async () => {
    await expect(
      controller.request(
        {
          consumerProjectId: "consumer-project",
          apiServiceId: "owner-api",
          environment: "test",
        },
        jwtRequest(),
      ),
    ).rejects.toThrow();
    await expect(
      controller.decide(
        "subscription-1",
        "approve",
        { apiServiceId: "owner-api" },
        jwtRequest(),
      ),
    ).rejects.toThrow();
  });

  it("ignores the actor header for JWT callers", async () => {
    await controller.request(
      {
        consumerProjectId: "consumer-project",
        apiServiceId: "owner-api",
        environment: "test",
      },
      jwtRequest("consumer-project"),
    );
    expect(subscriptions.request).toHaveBeenCalledWith(
      "jwt-user",
      expect.anything(),
    );
  });
});
