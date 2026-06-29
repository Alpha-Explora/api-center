import { checkProductionPilotApproval } from "../../../../src/data-pipeline/production-pilot-approval-checker";

describe("check-production-pilot-approval", () => {
  it("accepts a complete production pilot approval record", () => {
    const result = checkProductionPilotApproval({
      approved_prod_physical_topic: "prod.tribe.logistics.events",
      owner_tribe_id: "logistics",
      source_service_ids: ["logistics-api"],
      data_owner: "logistics-platform-owner",
      data_steward: "logistics-data-steward",
      approved_reader_groups: ["logistics-bi-readers"],
      metric_dictionary_rows_approved: ["order_created_daily"],
      raw_prod_retention_days: 90,
      athena_workgroup: "api-center-platform-validation-prod",
      bytes_scanned_limit: 1073741824,
      operator: "api-center-platform-operator",
      approval_timestamp: "2026-05-21T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.record).toEqual(
      expect.objectContaining({
        approved_prod_physical_topic: "prod.tribe.logistics.events",
        owner_tribe_id: "logistics",
      }),
    );
  });

  it("rejects missing fields and mismatched physical topic", () => {
    const result = checkProductionPilotApproval({
      approved_prod_physical_topic: "prod.tribe.other.events",
      owner_tribe_id: "logistics",
      source_service_ids: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "approved_prod_physical_topic must be prod.tribe.logistics.events for owner_tribe_id logistics.",
    );
    expect(result.errors).toContain("source_service_ids must not be empty.");
    expect(result.errors).toContain("data_owner is required.");
    expect(result.errors).toContain("data_steward is required.");
  });

  it("rejects the temporary SDK smoke tribe unless explicitly approved for prod", () => {
    const result = checkProductionPilotApproval({
      approved_prod_physical_topic:
        "prod.tribe.codex-sdk-20260520041053.events",
      owner_tribe_id: "codex-sdk-20260520041053",
      source_service_ids: ["codex-sdk-20260520041053-api"],
      data_owner: "api-center-platform",
      data_steward: "api-center-data-steward",
      approved_reader_groups: ["api-center-platform-validation-readers"],
      metric_dictionary_rows_approved: ["pipeline_flush_daily"],
      raw_prod_retention_days: 30,
      athena_workgroup: "api-center-platform-validation-prod",
      bytes_scanned_limit: 1073741824,
      operator: "api-center-platform-operator",
      approval_timestamp: "2026-05-21T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Temporary SDK smoke tribe cannot be used as prod pilot unless temporary_sdk_prod_approval is true.",
    );
  });

  it("rejects unresolved template placeholders", () => {
    const result = checkProductionPilotApproval({
      approved_prod_physical_topic: "prod.tribe.<tribe_id>.events",
      owner_tribe_id: "<tribe_id>",
      source_service_ids: ["<approved_source_service_id>"],
      data_owner: "<named_data_owner>",
      data_steward: "<named_data_steward>",
      approved_reader_groups: ["<approved_reader_group>"],
      metric_dictionary_rows_approved: ["<metric_name>"],
      raw_prod_retention_days: 90,
      athena_workgroup: "api-center-platform-validation-prod",
      bytes_scanned_limit: 1073741824,
      operator: "<operator_name_or_role>",
      approval_timestamp: "2026-05-21T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "approved_prod_physical_topic contains unresolved placeholder.",
    );
    expect(result.errors).toContain(
      "data_owner contains unresolved placeholder.",
    );
    expect(result.errors).toContain(
      "source_service_ids contains unresolved placeholder.",
    );
  });
});
