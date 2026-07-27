import {
  displayRuntimeEnvironment,
  parsePipelineLane,
  parseRuntimeEnvironment,
  readPipelineLaneQuery,
  toPipelineLane,
  toPlanStorageEnvironment,
  toRuntimeEnvironment,
} from "../../../../src/lib/environment-names";
import { describe, expect, it } from "vitest";

describe("Management environment naming", () => {
  it.each(["test", "live"])("accepts runtime environment %s", (value) => {
    expect(parseRuntimeEnvironment(value)).toBe(value);
  });

  it.each(["prod", "production", undefined])(
    "rejects %s as runtime environment",
    (value) => {
      expect(() => parseRuntimeEnvironment(value)).toThrow(
        "runtimeEnvironment must be one of: test, live",
      );
    },
  );

  it.each(["test", "prod"])("accepts pipeline lane %s", (value) => {
    expect(parsePipelineLane(value)).toBe(value);
  });

  it("maps live runtime to prod pipeline lane at the adapter boundary", () => {
    expect(toPipelineLane("test")).toBe("test");
    expect(toPipelineLane("live")).toBe("prod");
  });

  it("maps physical prod lanes back to public live display", () => {
    expect(toRuntimeEnvironment("prod")).toBe("live");
    expect(displayRuntimeEnvironment("prod")).toBe("live");
  });

  it("keeps old environment=prod route aliases while preferring pipelineLane", () => {
    expect(readPipelineLaneQuery(new URLSearchParams("pipelineLane=prod"))).toBe(
      "prod",
    );
    expect(readPipelineLaneQuery(new URLSearchParams("environment=prod"))).toBe(
      "prod",
    );
    expect(readPipelineLaneQuery(new URLSearchParams("environment=live"))).toBe(
      "prod",
    );
  });

  it("maps public live plan assignments to the current storage environment", () => {
    expect(toPlanStorageEnvironment("live")).toBe("prod");
    expect(toPlanStorageEnvironment("test")).toBe("test");
  });
});
