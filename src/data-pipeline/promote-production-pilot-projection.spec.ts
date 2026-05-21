import { planProductionPilotProjectionPromotion } from "./production-pilot-projection-promoter";

describe("planProductionPilotProjectionPromotion", () => {
  const approval = {
    approved_prod_physical_topic: "prod.tribe.logistics.events",
    owner_tribe_id: "logistics",
    source_service_ids: ["logistics-orders"],
    data_owner: "logistics-platform-owner",
    data_steward: "logistics-data-steward",
    approved_reader_groups: ["logistics-bi-readers"],
    metric_dictionary_rows_approved: ["order_created_daily"],
    raw_prod_retention_days: 90,
    athena_workgroup: "api-center-platform-validation-prod",
    bytes_scanned_limit: 1073741824,
    operator: "api-center-platform-operator",
    approval_timestamp: "2026-05-21T00:00:00.000Z",
  };

  const rawTopicTablesSql = `
CREATE EXTERNAL TABLE raw.kafka_topic_json (
  raw_line string
)
TBLPROPERTIES (
  'projection.physical_topic.values' = 'test.tribe.logistics.events'
);

CREATE EXTERNAL TABLE raw.kafka_topic_json_lines (
  raw_line string
)
TBLPROPERTIES (
  'projection.physical_topic.values' = 'test.tribe.logistics.events'
);
`;

  it("adds the approved prod topic and updates every raw table projection enum", () => {
    const result = planProductionPilotProjectionPromotion({
      approval,
      topics: ["test.tribe.logistics.events"],
      rawTopicTablesSql,
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.approvedTopic).toBe("prod.tribe.logistics.events");
    expect(result.topics).toEqual([
      "prod.tribe.logistics.events",
      "test.tribe.logistics.events",
    ]);
    expect(result.rawTopicTablesSql).toContain(
      "'projection.physical_topic.values' = 'prod.tribe.logistics.events,test.tribe.logistics.events'",
    );
    expect(
      result.rawTopicTablesSql.match(
        /prod\.tribe\.logistics\.events,test\.tribe\.logistics\.events/g,
      ),
    ).toHaveLength(2);
  });

  it("rejects an invalid approval record without changing projection inputs", () => {
    const result = planProductionPilotProjectionPromotion({
      approval: {
        ...approval,
        approved_prod_physical_topic: "prod.tribe.<tribe_id>.events",
      },
      topics: ["test.tribe.logistics.events"],
      rawTopicTablesSql,
    });

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.errors).toContain(
      "approved_prod_physical_topic contains unresolved placeholder.",
    );
    expect(result.topics).toEqual(["test.tribe.logistics.events"]);
    expect(result.rawTopicTablesSql).toBe(rawTopicTablesSql);
  });

  it("is a no-op when the approved prod topic is already projected", () => {
    const result = planProductionPilotProjectionPromotion({
      approval,
      topics: ["prod.tribe.logistics.events", "test.tribe.logistics.events"],
      rawTopicTablesSql: rawTopicTablesSql.replaceAll(
        "test.tribe.logistics.events",
        "prod.tribe.logistics.events,test.tribe.logistics.events",
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
  });
});
