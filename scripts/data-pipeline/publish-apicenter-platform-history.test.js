const assert = require("node:assert/strict");

const {
  buildSyntheticHistoryEvents,
  deriveBrokerFromRestEndpoint,
  normalizeOptions,
} = require("./publish-apicenter-platform-history");

{
  const options = normalizeOptions({
    environment: "test",
    days: 30,
    total: 1200,
    baseDate: "2026-05-23T00:00:00.000Z",
    runId: "synthetic-history-test",
  });
  const events = buildSyntheticHistoryEvents(options);

  assert.equal(events.length, 1200);
  assert.equal(new Set(events.map((event) => event.dayKey)).size, 30);
  assert.ok(events.every((event) => event.topic.startsWith("test.api-center.")));
  assert.ok(events.every((event) => !event.topic.startsWith("test.tribe.")));
  assert.ok(events.every((event) => event.value.syntheticHistory === true));
  assert.ok(
    events.every(
      (event) => event.value.syntheticRunId === "synthetic-history-test",
    ),
  );
}

{
  const options = normalizeOptions({
    environment: "test",
    days: 3,
    total: 7,
    baseDate: "2026-05-23T00:00:00.000Z",
  });
  const events = buildSyntheticHistoryEvents(options);

  assert.deepEqual(
    [...new Set(events.map((event) => event.dayKey))],
    ["2026-05-23", "2026-05-22", "2026-05-21"],
  );
}

{
  assert.throws(
    () => normalizeOptions({ environment: "prod", days: 30, total: 1200 }),
    /--allow-prod/,
  );
}

{
  assert.equal(
    deriveBrokerFromRestEndpoint(
      "https://pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:443",
    ),
    "pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092",
  );
}

console.log("publish-apicenter-platform-history tests passed");
