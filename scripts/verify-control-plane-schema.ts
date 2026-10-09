#!/usr/bin/env ts-node

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

type QualifiedObject = { schema: string; name: string };
type Row = Record<string, string | boolean | null>;
type InventoryObject = {
  schema: string;
  name: string;
  objectType: string;
  rowCount: string;
};

const repoRoot = path.resolve(__dirname, "..");
const controlledSchemas = ["apic_catalog", "apic_governance", "apic_runtime", "apic_audit"];
const legacySchemas = ["api_center", "api_center_ops", "api_center_audit"];
// Every schema the platform owns. Each is a bounded context: no foreign key may cross between them.
const domainSchemas = [
  ...controlledSchemas,
  "shared_payment",
  "shared_email",
  "shared_sms",
  "shared_otp",
  "shared_geo",
  "shared_gauth",
];

const requiredTables: QualifiedObject[] = [
  ["apic_catalog", "organizations"],
  ["apic_catalog", "services"],
  ["apic_catalog", "service_environments"],
  ["apic_catalog", "service_routes"],
  ["apic_catalog", "service_scopes"],
  ["apic_catalog", "service_dependencies"],
  ["apic_catalog", "shared_service_runtime_routes"],
  ["apic_catalog", "service_lifecycle_events"],
  ["apic_catalog", "service_secret_references"],
  ["apic_governance", "registry_change_requests"],
  ["apic_governance", "approval_requests"],
  ["apic_governance", "quota_policies"],
  ["apic_governance", "entitlement_plans"],
  ["apic_governance", "entitlement_assignments"],
  ["apic_governance", "promotion_evidence_bundles"],
  ["apic_governance", "payment_consumer_services"],
  ["apic_governance", "payment_api_keys"],
  ["apic_runtime", "provisioning_jobs"],
  ["apic_runtime", "event_topic_onboarding_states"],
  ["apic_runtime", "confluent_topics"],
  ["apic_runtime", "s3_sink_topics"],
  ["apic_runtime", "quota_evaluations"],
  ["apic_runtime", "health_snapshots"],
  ["apic_runtime", "smoke_test_runs"],
  ["apic_runtime", "usage_rollups"],
  ["apic_runtime", "pipeline_feedback_actions"],
  ["apic_audit", "audit_events"],
].map(([schema, name]) => ({ schema, name }));

const compatibilityViews: QualifiedObject[] = [
  ["api_center", "organizations"],
  ["api_center", "services"],
  ["api_center", "service_environments"],
  ["api_center", "service_routes"],
  ["api_center", "service_scopes"],
  ["api_center", "service_dependencies"],
  ["api_center", "service_lifecycle_events"],
  ["api_center", "tribe_secret_refs"],
  ["api_center", "confluent_topics"],
  ["api_center", "s3_sink_topics"],
  ["api_center_ops", "service_registration_requests"],
  ["api_center_ops", "approval_requests"],
  ["api_center_ops", "tribe_api_quota_policies"],
  ["api_center_ops", "tribe_plan_definitions"],
  ["api_center_ops", "tribe_plan_assignments"],
  ["api_center_ops", "provisioning_jobs"],
  ["api_center_ops", "topic_onboarding_states"],
  ["api_center_ops", "health_snapshots"],
  ["api_center_ops", "smoke_test_runs"],
  ["api_center_ops", "usage_rollups"],
  ["api_center_ops", "tribe_api_quota_decisions"],
  ["api_center_ops", "pipeline_feedback_actions"],
  ["api_center_audit", "audit_events"],
].map(([schema, name]) => ({ schema, name }));

const requiredIndexes = [
  "service_environments_service_id_idx",
  "service_environments_env_status_idx",
  "registry_change_requests_status_created_idx",
  "registry_change_requests_service_idx",
  "registry_change_requests_owner_idx",
  "approval_requests_status_created_idx",
  "approval_requests_action_env_idx",
  "approval_requests_target_idx",
  "quota_policies_owner_status_idx",
  "quota_policies_scope_target_idx",
  "entitlement_assignments_owner_env_status_idx",
  "entitlement_assignments_plan_env_idx",
  "promotion_evidence_service_env_created_idx",
  "promotion_evidence_correlation_idx",
  "shared_service_runtime_routes_service_env_uidx",
  "shared_service_runtime_routes_env_status_idx",
  "event_topic_onboarding_states_env_owner_idx",
  "event_topic_onboarding_states_updated_idx",
  "quota_evaluations_owner_created_idx",
  "quota_evaluations_outcome_created_idx",
  "quota_evaluations_correlation_idx",
  "quota_evaluations_environment_owner_created_idx",
  "quota_evaluations_env_route_window_idx",
  "health_snapshots_service_env_checked_idx",
  "smoke_test_runs_service_env_created_idx",
  "smoke_test_runs_tribe_service_env_created_idx",
  "usage_rollups_environment_window_idx",
  "usage_rollups_env_service_target_window_uidx",
  "pipeline_feedback_actions_env_target_idx",
  "pipeline_feedback_actions_status_created_idx",
  "pipeline_feedback_actions_owner_idx",
  "pipeline_feedback_actions_correlation_idx",
  "audit_events_created_idx",
  "audit_events_resource_idx",
  "audit_events_actor_idx",
  "audit_events_env_resource_correlation_idx",
  "audit_events_source_env_created_idx",
  "audit_events_tribe_env_created_idx",
];

const requiredCheckConstraints = [
  "registry_change_requests_status_check",
  "approval_requests_status_check",
  "approval_requests_target_environment_check",
  "quota_policies_mode_check",
  "quota_policies_status_check",
  "entitlement_assignments_status_check",
  "entitlement_assignments_environment_check",
  "promotion_evidence_source_environment_check",
  "promotion_evidence_target_environment_check",
  "promotion_evidence_distinct_environment_check",
  "shared_service_runtime_routes_environment_check",
  "shared_service_runtime_routes_status_check",
  "service_environments_environment_check",
  "event_topic_onboarding_states_environment_check",
  "pipeline_feedback_actions_environment_check",
  "quota_evaluations_environment_check",
  "health_snapshots_environment_check",
  "smoke_test_runs_environment_check",
  "usage_rollups_environment_check",
  "quota_evaluations_mode_check",
  "quota_evaluations_outcome_check",
  "audit_events_actor_type_check",
  "audit_events_outcome_check",
  "audit_events_environment_check",
];

const forbiddenLegacyObjectNames = [
  "service_registration_requests_status_created_idx",
  "service_registration_requests_service_idx",
  "service_registration_requests_owner_idx",
  "service_registration_requests_status_check",
  "tribe_quota_policies_owner_status_idx",
  "tribe_quota_policies_scope_target_idx",
  "tribe_quota_decisions_owner_created_idx",
  "tribe_quota_decisions_outcome_created_idx",
  "tribe_quota_decisions_correlation_idx",
  "tribe_plan_assignments_owner_env_status_idx",
  "tribe_plan_assignments_plan_env_idx",
  "topic_onboarding_states_env_owner_idx",
  "topic_onboarding_states_updated_idx",
];

const requiredSharedGauthTables = ["oauth_apps"];
const retiredSharedGauthTables = ["oauth_sessions", "oauth_accounts", "oauth_token_refs"];
const requiredOAuthAppConstraints = [
  "oauth_apps_pkey",
  "oauth_apps_environment_check",
  "oauth_apps_status_check",
  "oauth_apps_redirect_uris_check",
  "oauth_apps_client_id_check",
  "oauth_apps_client_pair_check",
  "oauth_apps_secret_ref_check",
];

const retentionManagedTables: QualifiedObject[] = [
  ["apic_audit", "audit_events"],
  ["apic_runtime", "quota_evaluations"],
  ["apic_runtime", "usage_rollups"],
  ["apic_runtime", "health_snapshots"],
  ["apic_runtime", "smoke_test_runs"],
  ["apic_runtime", "pipeline_feedback_actions"],
  ["apic_governance", "promotion_evidence_bundles"],
].map(([schema, name]) => ({ schema, name }));

const registryChildDeleteTables = new Set([
  "apic_catalog.service_environments",
  "apic_catalog.service_routes",
  "apic_catalog.service_scopes",
  "apic_catalog.service_dependencies",
]);

// Record tables for the SMS, OTP, and email runtimes live in their own schemas and are checked by name.
const requiredSharedTables = [
  "shared_sms.sms_messages",
  "shared_otp.otp_challenges",
  "shared_email.email_messages",
];
const retiredSharedTables = [
  "shared_sms.sms_records",
  "shared_sms.sms_delivery_events",
  "shared_otp.otp_records",
  "shared_otp.otp_attempts",
  "shared_otp.otp_delivery_events",
  "shared_email.email_templates",
  "shared_email.email_delivery_events",
];

type RuntimeRole = { role: string; schema: string; privileges: string[] };

// Each shared-service runtime connects as its own role. A role may use its own schema and nothing else.
const runtimeRoles: RuntimeRole[] = [
  { role: "payments_runtime", schema: "shared_payment", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { role: "email_runtime", schema: "shared_email", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { role: "sms_runtime", schema: "shared_sms", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { role: "otp_runtime", schema: "shared_otp", privileges: ["SELECT", "INSERT", "UPDATE"] },
  { role: "gauth_runtime", schema: "shared_gauth", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
];
const tablePrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"];
const tablePrivilegeColumns: Record<string, string> = {
  SELECT: "sel",
  INSERT: "ins",
  UPDATE: "upd",
  DELETE: "del",
  TRUNCATE: "tru",
};

async function verifyRuntimeRoles(client: any, failures: string[]): Promise<void> {
  for (const runtime of runtimeRoles) {
    const roleRows = await queryRows(client, "select rolname from pg_roles where rolname = $1", [runtime.role]);
    if (roleRows.length === 0) {
      failures.push("Runtime database role does not exist: " + runtime.role);
      continue;
    }

    const schemaRows = await queryRows(
      client,
      "select nspname as schema, has_schema_privilege($1, nspname, 'USAGE') as has_usage from pg_namespace where nspname = any($2::text[])",
      [runtime.role, domainSchemas],
    );
    const usable = schemaRows.filter((row) => row.has_usage === true).map((row) => String(row.schema));
    if (!usable.includes(runtime.schema)) {
      failures.push(runtime.role + " lacks USAGE on its own schema " + runtime.schema);
    }
    addFailure(
      failures,
      runtime.role + " can use schemas other than " + runtime.schema,
      usable.filter((schema) => schema !== runtime.schema),
    );

    const reachableTables = await queryRows(
      client,
      "select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = any($1::text[]) and n.nspname <> $2::text and (has_table_privilege($3::text, c.oid, 'SELECT') or has_table_privilege($3::text, c.oid, 'INSERT') or has_table_privilege($3::text, c.oid, 'UPDATE') or has_table_privilege($3::text, c.oid, 'DELETE') or has_table_privilege($3::text, c.oid, 'TRUNCATE'))",
      [domainSchemas, runtime.schema, runtime.role],
    );
    addFailure(
      failures,
      runtime.role + " has table privileges outside " + runtime.schema,
      reachableTables.map((row) => String(row.schema) + "." + String(row.name)),
    );

    const ownTables = await queryRows(
      client,
      "select c.relname as name, has_table_privilege($1::text, c.oid, 'SELECT') as sel, has_table_privilege($1::text, c.oid, 'INSERT') as ins, has_table_privilege($1::text, c.oid, 'UPDATE') as upd, has_table_privilege($1::text, c.oid, 'DELETE') as del, has_table_privilege($1::text, c.oid, 'TRUNCATE') as tru from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = $2::text",
      [runtime.role, runtime.schema],
    );
    if (ownTables.length === 0) {
      failures.push("No tables found in runtime schema " + runtime.schema);
    }

    const mismatches: string[] = [];
    for (const table of ownTables) {
      const objectName = runtime.schema + "." + String(table.name);
      for (const privilege of tablePrivileges) {
        const granted = table[tablePrivilegeColumns[privilege]] === true;
        const required = runtime.privileges.includes(privilege);
        if (required && !granted) mismatches.push(runtime.role + " lacks " + privilege + " on " + objectName);
        if (!required && granted) mismatches.push(runtime.role + " must not have " + privilege + " on " + objectName);
      }
    }
    addFailure(failures, "Runtime role table grants do not match its code", mismatches);
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function key(object: QualifiedObject): string {
  return object.schema + "." + object.name;
}

function missingObjects(required: QualifiedObject[], rows: Row[]): string[] {
  const found = new Set(rows.map((row) => String(row.schema) + "." + String(row.name)));
  return required.map(key).filter((name) => !found.has(name));
}

function addFailure(failures: string[], label: string, values: string[]): void {
  if (values.length === 0) return;
  failures.push(label + ":\n" + values.map((value) => "  - " + value).join("\n"));
}

async function queryRows(client: any, sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await client.query(sql, params);
  return result.rows as Row[];
}

function quoteIdent(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

async function printRowCountInventory(client: any): Promise<void> {
  const schemas = [...legacySchemas, ...controlledSchemas];
  const objects = await queryRows(
    client,
    "select table_schema as schema, table_name as name, table_type as object_type from information_schema.tables where table_schema = any($1::text[]) order by table_schema, table_name",
    [schemas],
  );
  const inventory: InventoryObject[] = [];

  for (const object of objects) {
    const schema = String(object.schema);
    const name = String(object.name);
    const objectType = String(object.object_type);
    let rowCount = "unavailable";

    try {
      const rows = await queryRows(client, "select count(*)::text as row_count from " + quoteIdent(schema) + "." + quoteIdent(name));
      rowCount = String(rows[0]?.row_count ?? "0");
    } catch (error) {
      rowCount = "error: " + (error instanceof Error ? error.message : String(error));
    }

    inventory.push({ schema, name, objectType, rowCount });
  }

  console.log("Control-plane row-count inventory:");
  if (inventory.length === 0) {
    console.log("  No APIC legacy or enterprise schema objects found.");
  } else {
    for (const object of inventory) {
      console.log("  " + object.schema + "." + object.name + " (" + object.objectType + "): " + object.rowCount);
    }
  }

  const baseTables = objects.filter((object) => object.object_type === "BASE TABLE");
  const views = objects.filter((object) => object.object_type === "VIEW");
  console.log("\nMissing enterprise tables:");
  const missingTables = missingObjects(requiredTables, baseTables);
  if (missingTables.length === 0) {
    console.log("  None");
  } else {
    for (const objectName of missingTables) console.log("  - " + objectName);
  }

  console.log("\nMissing compatibility views:");
  const missingViews = missingObjects(compatibilityViews, views);
  if (missingViews.length === 0) {
    console.log("  None");
  } else {
    for (const objectName of missingViews) console.log("  - " + objectName);
  }
}

function readApiSchemasFromConfig(): string[] {
  const configPath = path.join(repoRoot, "supabase", "config.toml");
  const content = fs.readFileSync(configPath, "utf8");
  const schemas: string[] = [];
  let inApiSection = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inApiSection = line === "[api]";
      continue;
    }
    if (!inApiSection || !line.startsWith("schemas")) continue;
    for (const match of line.matchAll(/"([^"]+)"/g)) {
      schemas.push(match[1]);
    }
  }

  return schemas;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to verify the control-plane schema.");
  }

  const appRole = readArg("--app-role");
  const failures: string[] = [];

  addFailure(
    failures,
    "APIC private schemas exposed through supabase/config.toml [api].schemas",
    readApiSchemasFromConfig().filter((schema) => controlledSchemas.includes(schema)),
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  if (hasFlag("--row-counts")) {
    try {
      await printRowCountInventory(client);
    } finally {
      await client.end();
    }
    return;
  }
  try {
    const tableRows = await queryRows(
      client,
      "select table_schema as schema, table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema = any($1::text[])",
      [controlledSchemas],
    );
    addFailure(failures, "Missing required enterprise tables", missingObjects(requiredTables, tableRows));

    const sharedTableRows = await queryRows(
      client,
      "select table_schema || '.' || table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('shared_sms', 'shared_otp', 'shared_email')",
    );
    const sharedNames = new Set(sharedTableRows.map((row) => String(row.name)));
    addFailure(
      failures,
      "Missing required shared-service record tables",
      requiredSharedTables.filter((name) => !sharedNames.has(name)),
    );
    addFailure(
      failures,
      "Retired shared-service tables still present",
      retiredSharedTables.filter((name) => sharedNames.has(name)),
    );

    const sharedGauthRows = await queryRows(
      client,
      "select table_name as name from information_schema.tables where table_schema = 'shared_gauth'",
    );
    const sharedGauthTables = new Set(sharedGauthRows.map((row) => String(row.name)));
    addFailure(
      failures,
      "Missing shared_gauth tables",
      requiredSharedGauthTables.filter((name) => !sharedGauthTables.has(name)).map((name) => "shared_gauth." + name),
    );
    addFailure(
      failures,
      "Retired shared_gauth tables still present",
      retiredSharedGauthTables.filter((name) => sharedGauthTables.has(name)).map((name) => "shared_gauth." + name),
    );

    const oauthAppConstraintRows = await queryRows(
      client,
      "select c.conname as name from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'shared_gauth' and r.relname = 'oauth_apps'",
    );
    const oauthAppConstraints = new Set(oauthAppConstraintRows.map((row) => String(row.name)));
    addFailure(
      failures,
      "Missing shared_gauth.oauth_apps constraints",
      requiredOAuthAppConstraints.filter((name) => !oauthAppConstraints.has(name)),
    );

    if (hasFlag("--require-compat-views")) {
      const viewRows = await queryRows(
        client,
        "select table_schema as schema, table_name as name from information_schema.views where table_schema = any($1::text[])",
        [legacySchemas],
      );
      addFailure(failures, "Missing compatibility views", missingObjects(compatibilityViews, viewRows));
    }

    if (hasFlag("--forbid-legacy-schemas")) {
      const legacySchemaRows = await queryRows(
        client,
        "select nspname as schema from pg_namespace where nspname = any($1::text[]) order by nspname",
        [legacySchemas],
      );
      addFailure(failures, "Legacy compatibility schemas still present", legacySchemaRows.map((row) => String(row.schema)));
    }

    const crossSchemaForeignKeys = await queryRows(
      client,
      "select n.nspname || '.' || t.relname as source, c.conname as name, rn.nspname || '.' || rt.relname as target from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace join pg_class rt on rt.oid = c.confrelid join pg_namespace rn on rn.oid = rt.relnamespace where c.contype = 'f' and n.nspname = any($1::text[]) and n.nspname <> rn.nspname order by 1, 2",
      [domainSchemas],
    );
    addFailure(
      failures,
      "Foreign keys across schemas (reference other contexts by identifier and validate through their public interface)",
      crossSchemaForeignKeys.map((row) => String(row.source) + " (" + String(row.name) + ") -> " + String(row.target)),
    );

    const indexRows = await queryRows(
      client,
      "select schemaname as schema, indexname as name from pg_indexes where schemaname = any($1::text[])",
      [controlledSchemas],
    );
    const indexNames = new Set(indexRows.map((row) => String(row.name)));
    addFailure(failures, "Missing required indexes", requiredIndexes.filter((name) => !indexNames.has(name)));

    const constraintRows = await queryRows(
      client,
      "select n.nspname as schema, c.conname as name from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where c.contype = 'c' and n.nspname = any($1::text[])",
      [controlledSchemas],
    );
    const constraintNames = new Set(constraintRows.map((row) => String(row.name)));
    addFailure(
      failures,
      "Missing required check constraints",
      requiredCheckConstraints.filter((name) => !constraintNames.has(name)),
    );

    addFailure(
      failures,
      "Legacy index or constraint names still present",
      forbiddenLegacyObjectNames.filter((name) => indexNames.has(name) || constraintNames.has(name)),
    );

    const environmentDefaultRows = await queryRows(
      client,
      "select table_schema as schema, table_name as name, column_name, column_default from information_schema.columns where table_schema = any($1::text[]) and column_name in ('environment', 'target_environment', 'source_environment') and column_default is not null",
      [controlledSchemas],
    );
    addFailure(
      failures,
      "Runtime environment columns with database defaults",
      environmentDefaultRows.map((row) => String(row.schema) + "." + String(row.name) + "." + String(row.column_name) + " default " + String(row.column_default)),
    );

    if (hasFlag("--require-retention-policy")) {
      const retentionRows = await queryRows(
        client,
        "select n.nspname as schema, c.relname as name, obj_description(c.oid) as comment, (pt.partrelid is not null) as partitioned from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_partitioned_table pt on pt.partrelid = c.oid where n.nspname = any($1::text[]) and c.relkind in ('r', 'p')",
        [controlledSchemas],
      );
      const retentionByName = new Map(retentionRows.map((row) => [String(row.schema) + "." + String(row.name), row]));
      addFailure(
        failures,
        "Missing retention comments or partition metadata",
        retentionManagedTables.map(key).filter((name) => {
          const row = retentionByName.get(name);
          return !row || (row.partitioned !== true && !String(row.comment ?? "").includes("retention="));
        }),
      );
    }

    const publicGrantRows = await queryRows(
      client,
      "select table_schema as schema, table_name as name, grantee, privilege_type from information_schema.role_table_grants where table_schema = any($1::text[]) and grantee in ('anon', 'authenticated')",
      [controlledSchemas],
    );
    addFailure(
      failures,
      "anon/authenticated direct grants on private APIC tables",
      publicGrantRows.map((row) => String(row.grantee) + " " + String(row.privilege_type) + " on " + String(row.schema) + "." + String(row.name)),
    );

    if (appRole) {
      const appRoleRows = await queryRows(client, "select rolname from pg_roles where rolname = $1", [appRole]);
      if (appRoleRows.length === 0) failures.push("Configured app role does not exist: " + appRole);

      const schemaPrivilegeRows = await queryRows(
        client,
        "select nspname as schema, has_schema_privilege($1, nspname, 'USAGE') as has_usage from pg_namespace where nspname = any($2::text[])",
        [appRole, controlledSchemas],
      );
      addFailure(
        failures,
        "Missing USAGE grants for app role " + appRole,
        schemaPrivilegeRows.filter((row) => row.has_usage !== true).map((row) => String(row.schema)),
      );

      const appGrantRows = await queryRows(
        client,
        "select table_schema as schema, table_name as name, privilege_type from information_schema.role_table_grants where grantee = $1 and table_schema = any($2::text[])",
        [appRole, controlledSchemas],
      );
      const grantsByTable = new Map<string, Set<string>>();
      for (const row of appGrantRows) {
        const objectName = String(row.schema) + "." + String(row.name);
        const grants = grantsByTable.get(objectName) ?? new Set<string>();
        grants.add(String(row.privilege_type));
        grantsByTable.set(objectName, grants);
      }

      const missingGrants: string[] = [];
      for (const table of requiredTables) {
        const objectName = key(table);
        const grants = grantsByTable.get(objectName) ?? new Set<string>();
        const required =
          table.schema === "apic_audit"
            ? ["SELECT", "INSERT"]
            : ["SELECT", "INSERT", "UPDATE"];
        if (registryChildDeleteTables.has(objectName)) required.push("DELETE");
        for (const privilege of required) {
          if (!grants.has(privilege)) missingGrants.push(appRole + " lacks " + privilege + " on " + objectName);
        }
      }
      addFailure(failures, "Missing app-role table grants", missingGrants);

      const auditGrants = grantsByTable.get("apic_audit.audit_events") ?? new Set<string>();
      for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
        if (auditGrants.has(privilege)) {
          failures.push(appRole + " must not have " + privilege + " on apic_audit.audit_events; audit events are append-only.");
        }
      }
    }
    await verifyRuntimeRoles(client, failures);
  } finally {
    await client.end();
  }

  if (failures.length > 0) {
    console.error("\nControl-plane schema verification failed:\n");
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }

  console.log("Control-plane schema verification passed.");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
