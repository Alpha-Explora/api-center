import {
  resolveEnvPartitionDate,
  resolvePartitionDate,
} from "../../../../src/data-pipeline/athena-partition-config";

describe("athena partition config", () => {
  it("reads environment partition keys by prefix", () => {
    expect(
      resolveEnvPartitionDate(
        {
          PIPELINE_HEALTH_YEAR: "2026",
          PIPELINE_HEALTH_MONTH: "06",
          PIPELINE_HEALTH_DAY: "19",
        } as NodeJS.ProcessEnv,
        "PIPELINE_HEALTH",
      ),
    ).toEqual({ year: "2026", month: "06", day: "19" });
  });

  it("prefers request partition date over options, env, and current date", () => {
    expect(
      resolvePartitionDate({
        partitionDate: { year: "2026", month: "05", day: "20" },
        options: { year: "2025", month: "04", day: "19" },
        env: {
          PIPELINE_HEALTH_YEAR: "2024",
          PIPELINE_HEALTH_MONTH: "03",
          PIPELINE_HEALTH_DAY: "18",
        } as NodeJS.ProcessEnv,
        prefixes: ["PIPELINE_HEALTH"],
        now: new Date("2023-02-17T00:00:00.000Z"),
      }),
    ).toEqual({ year: "2026", month: "05", day: "20" });
  });

  it("falls back through options, ordered env prefixes, and current UTC date", () => {
    expect(
      resolvePartitionDate({
        options: { year: "2026" },
        env: {
          PIPELINE_DECISION_SIGNALS_MONTH: "06",
          PIPELINE_GOVERNANCE_DAY: "19",
        } as NodeJS.ProcessEnv,
        prefixes: ["PIPELINE_DECISION_SIGNALS", "PIPELINE_GOVERNANCE"],
        now: new Date("2025-04-18T00:00:00.000Z"),
      }),
    ).toEqual({ year: "2026", month: "06", day: "19" });
  });
});
