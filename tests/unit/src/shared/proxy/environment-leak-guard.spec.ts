import { enforceEnvironmentAccess } from "../../../../../src/shared/proxy/environment-leak-guard";
import { ForbiddenError, ServiceUnavailableError } from "../../../../../src/shared/errors";

const target = {
  serviceId: "orders",
  environments: [
    { environment: "test" as const, baseUrl: "https://orders-test.example.com", status: "active" },
    { environment: "live" as const, baseUrl: "https://orders.example.com", status: "active" },
  ],
};

describe("enforceEnvironmentAccess", () => {
  it("selects the runtime matching the validated token environment", () => {
    expect(
      enforceEnvironmentAccess({ callerEnvironment: "test", target }),
    ).toMatchObject({
      environment: "test",
      baseUrl: "https://orders-test.example.com",
    });
  });

  it("rejects missing APICenter token environment", () => {
    expect(() =>
      enforceEnvironmentAccess({ callerEnvironment: undefined, target }),
    ).toThrow(new ForbiddenError("APICenter token is missing environment"));
  });

  it("rejects invalid APICenter token environment", () => {
    expect(() =>
      enforceEnvironmentAccess({ callerEnvironment: "staging" as never, target }),
    ).toThrow(new ForbiddenError("APICenter token environment is invalid"));
  });

  it("rejects missing target runtime URL for the requested environment", () => {
    expect(() =>
      enforceEnvironmentAccess({
        callerEnvironment: "live",
        target: { serviceId: "orders", environments: [target.environments[0]] },
      }),
    ).toThrow(ServiceUnavailableError);
  });
});