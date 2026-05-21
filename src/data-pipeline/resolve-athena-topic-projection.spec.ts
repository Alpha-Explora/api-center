import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scriptPath = resolve(
  __dirname,
  "../../scripts/data-pipeline/resolve-athena-topic-projection.js",
);

let resolveProjection: (options: {
  topicsFile?: string;
  topics: string[];
}) => string;
let checkProjectionDrift: (options: {
  topicsFile: string;
  expectedTopics?: string[];
  rawTopicTablesSqlFile?: string;
  onboardingStateFile?: string;
  confluentTopics?: string[];
}) => {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

describe("resolve-athena-topic-projection", () => {
  beforeAll(async () => {
    ({ resolveProjection, checkProjectionDrift } = await import(scriptPath));
  });

  it("prints sorted unique projection values from a topic file", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");

    try {
      writeFileSync(
        topicsFile,
        [
          "test.tribe.logistics.events",
          "# duplicate and comment lines are ignored",
          "test.api-center.gateway.request",
          "test.tribe.logistics.events",
          "",
        ].join("\n"),
      );

      const output = resolveProjection({ topicsFile, topics: [] });

      expect(output).toBe(
        "test.api-center.gateway.request,test.tribe.logistics.events",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects invalid topic names before emitting Athena SQL values", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");

    try {
      writeFileSync(topicsFile, "test.tribe.bad topic.events\n");

      expect(() => resolveProjection({ topicsFile, topics: [] })).toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports expected topics missing from projection values", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");

    try {
      writeFileSync(topicsFile, "test.tribe.logistics.events\n");

      const report = checkProjectionDrift({
        topicsFile,
        expectedTopics: ["test.tribe.servease.events"],
      });

      expect(report.ok).toBe(false);
      expect(report.errors).toContain(
        "Expected topic is missing from projection values: test.tribe.servease.events",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports unsorted projection values and raw SQL enum drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");
    const rawSqlFile = join(dir, "raw-topic-tables.sql");

    try {
      writeFileSync(
        topicsFile,
        ["test.tribe.servease.events", "test.tribe.logistics.events"].join(
          "\n",
        ),
      );
      writeFileSync(
        rawSqlFile,
        "'projection.physical_topic.values' = 'test.tribe.logistics.events'",
      );

      const report = checkProjectionDrift({
        topicsFile,
        rawTopicTablesSqlFile: rawSqlFile,
      });

      expect(report.ok).toBe(false);
      expect(report.errors).toContain(
        "Projection values file is not sorted and unique.",
      );
      expect(report.errors).toContain(
        "raw-topic-tables.sql projection enum does not match generated topic projection values.",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports onboarding-state topics missing from projection values", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");
    const stateFile = join(dir, "topic-onboarding-states.json");

    try {
      writeFileSync(topicsFile, "test.tribe.logistics.events\n");
      writeFileSync(
        stateFile,
        JSON.stringify({
          records: [
            {
              owner_tribe_id: "servease",
              physical_topic: "test.tribe.servease.events",
              current_state: "Topic provisioned",
            },
          ],
        }),
      );

      const report = checkProjectionDrift({
        topicsFile,
        onboardingStateFile: stateFile,
      });

      expect(report.ok).toBe(false);
      expect(report.errors).toContain(
        "Onboarding-state topic is missing from projection values: test.tribe.servease.events",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("ignores unmanaged Confluent topics when checking projection drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "apic-topic-projection-"));
    const topicsFile = join(dir, "topics.txt");

    try {
      writeFileSync(topicsFile, "test.tribe.logistics.events\n");

      const report = checkProjectionDrift({
        topicsFile,
        confluentTopics: [
          "__consumer_offsets",
          "_confluent-command",
          "unmanaged.topic",
          "test.tribe.logistics.events",
        ],
      });

      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
