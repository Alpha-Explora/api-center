import { generateTribeCuratedSql } from "../../../../src/data-pipeline/tribe-curated-sql-generator";

describe("generate-tribe-curated-sql", () => {
  it("prints tribe Silver, Gold, and bounded validation SQL in dry-run mode", () => {
    const result = generateTribeCuratedSql({
      tribeId: "logistics",
      environment: "test",
      eventType: "order.created",
      metricName: "order_created_daily",
      owner: "logistics-platform",
      steward: "logistics-data-steward",
      approvedReaderGroup: "logistics-bi-readers",
      year: "2026",
      month: "05",
      day: "21",
    });

    expect(result.mode).toBe("dry-run");
    expect(result.metadata).toEqual(
      expect.objectContaining({
        tribe_id: "logistics",
        environment: "test",
        domain_event_type: "order.created",
        metric_name: "order_created_daily",
        owner: "logistics-platform",
        steward: "logistics-data-steward",
        approved_reader_group: "logistics-bi-readers",
        source_common_silver_view: "common_silver.tribe_event_envelope",
      }),
    );
    expect(result.silver_sql).toContain(
      "CREATE OR REPLACE VIEW silver_logistics.order_created AS",
    );
    expect(result.silver_sql).toContain("owner: logistics-platform");
    expect(result.silver_sql).toContain("WHERE environment = 'test'");
    expect(result.silver_sql).toContain("AND tribe_id = 'logistics'");
    expect(result.silver_sql).toContain("AND event_type = 'order.created'");
    expect(result.gold_sql).toContain(
      "CREATE OR REPLACE VIEW gold_logistics.order_created_daily AS",
    );
    expect(result.gold_sql).toContain("FROM silver_logistics.order_created");
    expect(result.validation_sql).toContain("WHERE environment = 'test'");
    expect(result.validation_sql).toContain("AND tribe_id = 'logistics'");
    expect(result.validation_sql).toContain("AND event_type = 'order.created'");
    expect(result.validation_sql).toContain("AND year = '2026'");
    expect(result.validation_sql).toContain("AND month = '05'");
    expect(result.validation_sql).toContain("AND day = '21'");
  });
});
