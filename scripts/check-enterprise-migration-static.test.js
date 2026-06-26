const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runStaticEnterpriseMigrationChecks, extractForeignKeys, findMissingForeignKeyIndexes, findStatusColumnsWithoutCheck } = require("./check-enterprise-migration-static.js");

function run(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-static-migration-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function validMigrationSql() {
  return [
    "create schema if not exists apic_catalog;",
    "create schema if not exists apic_governance;",
    "create schema if not exists apic_runtime;",
    "create schema if not exists apic_audit;",
    "create table if not exists apic_catalog.organizations (id uuid primary key, status text constraint organizations_status_check check (status in ('active')));",
    "create table if not exists apic_catalog.services (id uuid primary key, status text constraint services_status_check check (status in ('active')));",
    "create table if not exists apic_catalog.service_environments (id uuid primary key, service_id uuid references apic_catalog.services(id), status text constraint service_environments_status_check check (status in ('active')));",
    "create table if not exists apic_catalog.service_secret_references (id uuid primary key, status text constraint service_secret_references_status_check check (status in ('active')));",
    "create table if not exists apic_governance.registry_change_requests (id uuid primary key, status text constraint registry_change_requests_status_check check (status in ('pending')));",
    "create table if not exists apic_governance.approval_requests (id uuid primary key, status text constraint approval_requests_status_check check (status in ('pending')));",
    "create table if not exists apic_governance.quota_policies (id uuid primary key, mode text constraint quota_policies_mode_check check (mode in ('observe')), status text constraint quota_policies_status_check check (status in ('active')));",
    "create table if not exists apic_governance.entitlement_assignments (id uuid primary key, status text constraint entitlement_assignments_status_check check (status in ('active')));",
    "create table if not exists apic_runtime.event_topic_onboarding_states (id uuid primary key);",
    "create table if not exists apic_runtime.provisioning_jobs (id uuid primary key, status text constraint provisioning_jobs_status_check check (status in ('pending')));",
    "create table if not exists apic_runtime.quota_evaluations (id uuid primary key, mode text constraint quota_evaluations_mode_check check (mode in ('observe')), outcome text constraint quota_evaluations_outcome_check check (outcome in ('allowed')));",
    "create table if not exists apic_runtime.usage_rollups (id uuid primary key);",
    "create table if not exists apic_runtime.health_snapshots (id uuid primary key);",
    "create table if not exists apic_runtime.smoke_test_runs (id uuid primary key, status text constraint smoke_test_runs_status_check check (status in ('passed')));",
    "create table if not exists apic_runtime.pipeline_feedback_actions (id uuid primary key, status text constraint pipeline_feedback_actions_status_check check (status in ('pending')));",
    "create table if not exists apic_audit.audit_events (id uuid primary key, actor_type text constraint audit_events_actor_type_check check (actor_type in ('system')), outcome text constraint audit_events_outcome_check check (outcome in ('succeeded')));",
    "create index if not exists service_environments_service_id_idx on apic_catalog.service_environments(service_id);",
    "create index if not exists service_environments_env_status_idx on apic_catalog.service_environments(status);",
    "create index if not exists registry_change_requests_status_created_idx on apic_governance.registry_change_requests(status);",
    "create index if not exists registry_change_requests_service_idx on apic_governance.registry_change_requests(id);",
    "create index if not exists registry_change_requests_owner_idx on apic_governance.registry_change_requests(id);",
    "create index if not exists approval_requests_status_created_idx on apic_governance.approval_requests(status);",
    "create index if not exists approval_requests_action_env_idx on apic_governance.approval_requests(id);",
    "create index if not exists approval_requests_target_idx on apic_governance.approval_requests(id);",
    "create index if not exists quota_policies_owner_status_idx on apic_governance.quota_policies(status);",
    "create index if not exists quota_policies_scope_target_idx on apic_governance.quota_policies(id);",
    "create index if not exists entitlement_assignments_owner_env_status_idx on apic_governance.entitlement_assignments(status);",
    "create index if not exists entitlement_assignments_plan_env_idx on apic_governance.entitlement_assignments(id);",
    "create index if not exists event_topic_onboarding_states_env_owner_idx on apic_runtime.event_topic_onboarding_states(id);",
    "create index if not exists event_topic_onboarding_states_updated_idx on apic_runtime.event_topic_onboarding_states(id);",
    "create index if not exists quota_evaluations_owner_created_idx on apic_runtime.quota_evaluations(id);",
    "create index if not exists quota_evaluations_outcome_created_idx on apic_runtime.quota_evaluations(outcome);",
    "create index if not exists quota_evaluations_correlation_idx on apic_runtime.quota_evaluations(id);",
    "create index if not exists pipeline_feedback_actions_env_target_idx on apic_runtime.pipeline_feedback_actions(id);",
    "create index if not exists pipeline_feedback_actions_status_created_idx on apic_runtime.pipeline_feedback_actions(id);",
    "create index if not exists pipeline_feedback_actions_owner_idx on apic_runtime.pipeline_feedback_actions(id);",
    "create index if not exists pipeline_feedback_actions_correlation_idx on apic_runtime.pipeline_feedback_actions(id);",
    "create index if not exists audit_events_created_idx on apic_audit.audit_events(id);",
    "create index if not exists audit_events_resource_idx on apic_audit.audit_events(id);",
    "create index if not exists audit_events_actor_idx on apic_audit.audit_events(id);",
    "comment on table apic_audit.audit_events is 'retention=400d';",
    "comment on table apic_runtime.quota_evaluations is 'retention=180d';",
    "comment on table apic_runtime.usage_rollups is 'retention=400d';",
    "comment on table apic_runtime.health_snapshots is 'retention=90d';",
    "comment on table apic_runtime.smoke_test_runs is 'retention=180d';",
    "comment on table apic_runtime.pipeline_feedback_actions is 'retention=365d';",
    "revoke all on schema apic_catalog, apic_governance, apic_runtime, apic_audit from public;",
    "revoke delete on all tables in schema apic_audit from api_center_app;",
    "grant usage on schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app;",
  ].join("\n");
}

function repoFiles(sql = validMigrationSql(), config = "[api]\nschemas = [\"public\", \"graphql_public\"]\n") {
  return {
    "supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql": sql,
    "supabase/config.toml": config,
  };
}

run("passes a migration with enterprise names, retention metadata, and private schemas", () => {
  withTempRepo(repoFiles(), (repoRoot) => {
    assert.deepEqual(runStaticEnterpriseMigrationChecks({ repoRoot }), []);
  });
});

run("fails when control-plane schemas are exposed through Supabase Data API", () => {
  withTempRepo(repoFiles(validMigrationSql(), "[api]\nschemas = [\"public\", \"apic_catalog\"]\n"), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /apic_catalog.*exposed/i);
  });
});

run("fails when a required retention comment is missing", () => {
  const sql = validMigrationSql().replace(/comment on table apic_runtime\.usage_rollups[^;]+;\n?/, "");
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /apic_runtime\.usage_rollups.*retention/i);
  });
});

run("fails when a status column check constraint is missing", () => {
  const sql = validMigrationSql().replace(/status text constraint pipeline_feedback_actions_status_check check \([^;]+?\)/, "status text");
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /pipeline_feedback_actions_status_check/i);
  });
});

run("fails generically when a future status column lacks a check constraint", () => {
  const sql = validMigrationSql() + "\ncreate table if not exists apic_runtime.future_status_table (id uuid primary key, status text not null);\n";
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /future_status_table\.status/i);
  });
  assert.deepEqual(findStatusColumnsWithoutCheck(sql).filter((entry) => entry.table === "apic_runtime.future_status_table"), [
    { table: "apic_runtime.future_status_table", column: "status" },
  ]);
});

run("fails when audit delete denial is missing", () => {
  const sql = validMigrationSql().replace(/revoke delete on all tables in schema apic_audit from api_center_app;\n?/, "");
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /audit delete denial/i);
  });
});

run("fails when private schemas are granted to anon or authenticated", () => {
  const sql = validMigrationSql() + "\ngrant select on all tables in schema apic_catalog to authenticated;\n";
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /anon\/authenticated/i);
  });
});

run("fails when legacy object names are created instead of normalized", () => {
  const sql = validMigrationSql() + "\ncreate index if not exists service_registration_requests_status_created_idx on apic_governance.registry_change_requests(status);\n";
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /legacy.*service_registration_requests_status_created_idx/i);
  });
});

run("extracts foreign keys from migration DDL", () => {
  const foreignKeys = extractForeignKeys(validMigrationSql());
  assert.deepEqual(foreignKeys.filter((foreignKey) => foreignKey.table === "apic_catalog.service_environments"), [
    { table: "apic_catalog.service_environments", columns: ["service_id"], references: "apic_catalog.services(id)" },
  ]);
});

run("fails when a foreign key column lacks a leading index", () => {
  const sql = validMigrationSql().replace(/create index if not exists service_environments_service_id_idx[^;]+;\n?/, "");
  withTempRepo(repoFiles(sql), (repoRoot) => {
    assert.match(runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n"), /Missing FK index on apic_catalog\.service_environments\(service_id\)/i);
  });
});

run("accepts foreign key coverage from unique constraints", () => {
  const sql = validMigrationSql() + "\ncreate table if not exists apic_catalog.service_routes (id uuid primary key, service_id uuid references apic_catalog.services(id), path text not null, unique (service_id, path));\n";
  const missing = findMissingForeignKeyIndexes(sql).filter((entry) => entry.table === "apic_catalog.service_routes");
  assert.deepEqual(missing, []);
});

run("fails when future gateway or shared-core DDL is introduced in phase 1", () => {
  const sql = validMigrationSql() + "\ncreate schema if not exists shared_core;\ncreate schema if not exists apic_gateway;\n";
  withTempRepo(repoFiles(sql), (repoRoot) => {
    const result = runStaticEnterpriseMigrationChecks({ repoRoot }).join("\n");
    assert.match(result, /shared_core/);
    assert.match(result, /apic_gateway/);
  });
});
