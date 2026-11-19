import { assertNoEnvironmentOverrides } from "../../../../../apps/gateway/src/shared/proxy/environment-leak-guard";
import { ForbiddenError } from "../../../../../apps/gateway/src/shared/errors";

describe("assertNoEnvironmentOverrides", () => {
  it("accepts a request that leaves the environment to the key", () => {
    expect(() => assertNoEnvironmentOverrides({ headers: { accept: "application/json" }, query: { page: "1" }, body: { to: "a@example.test" } })).not.toThrow();
  });

  it.each([
    [{ headers: { "X-APICenter-Environment": "live" } }],
    [{ headers: { "x-target-environment": "live" } }],
    [{ query: { environment: "live" } }],
    [{ body: { targetEnvironment: "live" } }],
  ])("refuses an environment override in %j", (input) => {
    expect(() => assertNoEnvironmentOverrides(input)).toThrow(ForbiddenError);
  });
});
