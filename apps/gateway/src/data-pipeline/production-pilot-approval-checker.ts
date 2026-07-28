export interface ProductionPilotApprovalRecord {
  approved_prod_physical_topic?: string;
  owner_tribe_id?: string;
  source_service_ids?: string[] | string;
  data_owner?: string;
  data_steward?: string;
  approved_reader_groups?: string[] | string;
  metric_dictionary_rows_approved?: string[] | string;
  raw_prod_retention_days?: number | string;
  athena_workgroup?: string;
  bytes_scanned_limit?: number | string;
  operator?: string;
  approval_timestamp?: string;
  temporary_sdk_prod_approval?: boolean;
}

export interface ProductionPilotApprovalResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  record: {
    approved_prod_physical_topic: string;
    owner_tribe_id: string;
    source_service_ids: string[];
    data_owner: string;
    data_steward: string;
    approved_reader_groups: string[];
    metric_dictionary_rows_approved: string[];
    raw_prod_retention_days: number;
    athena_workgroup: string;
    bytes_scanned_limit: number;
    operator: string;
    approval_timestamp: string;
    temporary_sdk_prod_approval: boolean;
  };
}

const TEMPORARY_SDK_TRIBE_ID = "codex-sdk-20260520041053";

export function checkProductionPilotApproval(
  input: ProductionPilotApprovalRecord,
): ProductionPilotApprovalResult {
  const record = normalizeRecord(input);
  const errors: string[] = [];
  const warnings: string[] = [];

  requireString(record.owner_tribe_id, "owner_tribe_id", errors);
  requireString(
    record.approved_prod_physical_topic,
    "approved_prod_physical_topic",
    errors,
  );
  requireString(record.data_owner, "data_owner", errors);
  requireString(record.data_steward, "data_steward", errors);
  requireString(record.athena_workgroup, "athena_workgroup", errors);
  requireString(record.operator, "operator", errors);
  requireString(record.approval_timestamp, "approval_timestamp", errors);
  rejectPlaceholder(
    record.approved_prod_physical_topic,
    "approved_prod_physical_topic",
    errors,
  );
  rejectPlaceholder(record.owner_tribe_id, "owner_tribe_id", errors);
  rejectPlaceholder(record.data_owner, "data_owner", errors);
  rejectPlaceholder(record.data_steward, "data_steward", errors);
  rejectPlaceholder(record.athena_workgroup, "athena_workgroup", errors);
  rejectPlaceholder(record.operator, "operator", errors);
  rejectPlaceholder(record.source_service_ids, "source_service_ids", errors);
  rejectPlaceholder(
    record.approved_reader_groups,
    "approved_reader_groups",
    errors,
  );
  rejectPlaceholder(
    record.metric_dictionary_rows_approved,
    "metric_dictionary_rows_approved",
    errors,
  );

  if (record.source_service_ids.length === 0) {
    errors.push("source_service_ids must not be empty.");
  }
  if (record.approved_reader_groups.length === 0) {
    errors.push("approved_reader_groups must not be empty.");
  }
  if (record.metric_dictionary_rows_approved.length === 0) {
    errors.push("metric_dictionary_rows_approved must not be empty.");
  }

  if (
    record.owner_tribe_id &&
    record.approved_prod_physical_topic &&
    record.approved_prod_physical_topic !==
      `prod.tribe.${record.owner_tribe_id}.events`
  ) {
    errors.push(
      `approved_prod_physical_topic must be prod.tribe.${record.owner_tribe_id}.events for owner_tribe_id ${record.owner_tribe_id}.`,
    );
  }

  if (
    record.approved_prod_physical_topic &&
    !/^prod\.tribe\.[a-z0-9._-]+\.events$/.test(
      record.approved_prod_physical_topic,
    )
  ) {
    errors.push(
      "approved_prod_physical_topic must match prod.tribe.<tribe_id>.events.",
    );
  }

  if (record.athena_workgroup && !record.athena_workgroup.endsWith("-prod")) {
    errors.push(
      "athena_workgroup must be an environment-specific prod workgroup.",
    );
  }

  if (!Number.isFinite(record.raw_prod_retention_days)) {
    errors.push("raw_prod_retention_days must be a number.");
  } else if (record.raw_prod_retention_days < 1) {
    errors.push("raw_prod_retention_days must be greater than zero.");
  }

  if (!Number.isFinite(record.bytes_scanned_limit)) {
    errors.push("bytes_scanned_limit must be a number.");
  } else if (record.bytes_scanned_limit < 1) {
    errors.push("bytes_scanned_limit must be greater than zero.");
  }

  if (
    record.owner_tribe_id === TEMPORARY_SDK_TRIBE_ID &&
    !record.temporary_sdk_prod_approval
  ) {
    errors.push(
      "Temporary SDK smoke tribe cannot be used as prod pilot unless temporary_sdk_prod_approval is true.",
    );
  }

  if (
    record.approval_timestamp &&
    Number.isNaN(Date.parse(record.approval_timestamp))
  ) {
    errors.push("approval_timestamp must be an ISO-8601 timestamp.");
  }

  if (record.approved_reader_groups.some((group) => /raw/i.test(group))) {
    warnings.push(
      "approved_reader_groups references raw access; prod readers should use curated outputs or governed Athena result prefixes.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    record,
  };
}

function normalizeRecord(input: ProductionPilotApprovalRecord) {
  const ownerTribeId = normalizeIdentifierLike(input.owner_tribe_id);
  return {
    approved_prod_physical_topic: readString(
      input.approved_prod_physical_topic,
    ),
    owner_tribe_id: ownerTribeId,
    source_service_ids: readList(input.source_service_ids),
    data_owner: readString(input.data_owner),
    data_steward: readString(input.data_steward),
    approved_reader_groups: readList(input.approved_reader_groups),
    metric_dictionary_rows_approved: readList(
      input.metric_dictionary_rows_approved,
    ),
    raw_prod_retention_days: Number(input.raw_prod_retention_days),
    athena_workgroup: readString(input.athena_workgroup),
    bytes_scanned_limit: Number(input.bytes_scanned_limit),
    operator: readString(input.operator),
    approval_timestamp: readString(input.approval_timestamp),
    temporary_sdk_prod_approval: input.temporary_sdk_prod_approval === true,
  };
}

function requireString(value: string, field: string, errors: string[]): void {
  if (!value) errors.push(`${field} is required.`);
}

function rejectPlaceholder(
  value: string | string[],
  field: string,
  errors: string[],
): void {
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => /<[^>]+>/.test(item))) {
    errors.push(`${field} contains unresolved placeholder.`);
  }
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map(readString).filter(Boolean);
  }
  return [];
}

function normalizeIdentifierLike(value: unknown): string {
  return readString(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]/g, "-");
}
