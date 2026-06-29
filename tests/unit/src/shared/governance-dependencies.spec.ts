import {
  GovernanceDependencyError,
  requireGovernanceDependency,
} from "../../../../src/shared/governance-dependencies";

describe("requireGovernanceDependency", () => {
  it("returns the dependency when present", () => {
    const dependency = { check: jest.fn() };

    expect(requireGovernanceDependency(dependency, "Quota")).toBe(dependency);
  });

  it("throws a governance dependency error when missing", () => {
    expect(() => requireGovernanceDependency(undefined, "Quota")).toThrow(
      GovernanceDependencyError,
    );
  });
});
