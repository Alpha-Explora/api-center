import {
  resolvePipelineDatasetSource,
  resolvePositiveQueryLimit,
} from "../../../../apps/gateway/src/data-pipeline/pipeline-dataset-provider";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";

describe("pipeline dataset provider helpers", () => {
  it("selects the first configured fixture or Athena source", () => {
    expect(
      resolvePipelineDatasetSource(
        [undefined, "athena", "fixture"],
        "source must be fixture or athena.",
      ),
    ).toBe("athena");
  });

  it("throws a validation error for unsupported sources", () => {
    expect(() =>
      resolvePipelineDatasetSource(
        ["warehouse"],
        "source must be fixture or athena.",
      ),
    ).toThrow(new ValidationError("source must be fixture or athena."));
  });

  it("uses positive configured query limits before fallback values", () => {
    expect(resolvePositiveQueryLimit(250, 100)).toBe(250);
    expect(resolvePositiveQueryLimit(0, 500)).toBe(500);
    expect(resolvePositiveQueryLimit(Number.NaN, 0)).toBe(100);
  });
});
