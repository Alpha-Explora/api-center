import {
  assertRuntimeEnvironment,
  toPhysicalPipelineEnvironment,
} from "./environment-names";

describe("environment naming boundaries", () => {
  it.each(["test", "live"])(
    "accepts public runtime environment %s",
    (value) => {
      expect(assertRuntimeEnvironment(value)).toBe(value);
    },
  );

  it.each(["prod", "production", "", undefined])(
    "rejects %s as a public runtime environment",
    (value) => {
      expect(() => assertRuntimeEnvironment(value)).toThrow(
        "runtimeEnvironment must be one of: test, live",
      );
    },
  );

  it("maps live runtime to the physical prod pipeline lane only at the boundary", () => {
    expect(toPhysicalPipelineEnvironment("test")).toBe("test");
    expect(toPhysicalPipelineEnvironment("live")).toBe("prod");
  });
});
