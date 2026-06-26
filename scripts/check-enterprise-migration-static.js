#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const CONTROLLED_SCHEMAS = ["apic_catalog", "apic_governance", "apic_runtime", "apic_audit"];
const REQUIRED_INDEXES = [
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
  "event_topic_onboarding_states_env_owner_idx",
  "event_topic_onboarding_states_updated_idx",
  "quota_evaluations_owner_created_idx",
  "quota_evaluations_outcome_created_idx",
  "quota_evaluations_correlation_idx",
  "pipeline_feedback_actions_env_target_idx",
  "pipeline_feedback_actions_status_created_idx",
  "pipeline_feedback_actions_owner_idx",
  "pipeline_feedback_actions_correlation_idx",
  "audit_events_created_idx",
  "audit_events_resource_idx",
  "audit_events_actor_idx",
];

const REQUIRED_CHECK_CONSTRAINTS = [
  "organizations_status_check",
  "services_status_check",
  "service_environments_status_check",
  "service_secret_references_status_check",
  "registry_change_requests_status_check",
  "approval_requests_status_check",
  "quota_policies_mode_check",
  "quota_policies_status_check",
  "entitlement_assignments_status_check",
  "provisioning_jobs_status_check",
  "smoke_test_runs_status_check",
  "pipeline_feedback_actions_status_check",
  "quota_evaluations_mode_check",
  "quota_evaluations_outcome_check",
  "audit_events_actor_type_check",
  "audit_events_outcome_check",
];

const RETENTION_TABLES = [
  "apic_audit.audit_events",
  "apic_runtime.quota_evaluations",
  "apic_runtime.usage_rollups",
  "apic_runtime.health_snapshots",
  "apic_runtime.smoke_test_runs",
  "apic_runtime.pipeline_feedback_actions",
];

const FORBIDDEN_LEGACY_OBJECT_NAMES = [
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

function runStaticEnterpriseMigrationChecks({ repoRoot = path.resolve(__dirname, "..") } = {}) {
  const migrationPath = path.join(repoRoot, "supabase", "migrations", "20260625162216_enterprise_control_plane_schemas.sql");
  const configPath = path.join(repoRoot, "supabase", "config.toml");
  const sql = readFile(migrationPath);
  const config = readFile(configPath);
  const failures = [];

  for (const schema of readApiSchemasFromConfig(config)) {
    if (CONTROLLED_SCHEMAS.includes(schema)) failures.push(schema + " is exposed through Supabase Data API [api].schemas.");
  }

  for (const name of REQUIRED_INDEXES) {
    if (!hasCreateIndex(sql, name)) failures.push("Missing enterprise index " + name + ".");
  }

  for (const name of REQUIRED_CHECK_CONSTRAINTS) {
    if (!hasCheckConstraint(sql, name)) failures.push("Missing enterprise check constraint " + name + ".");
  }

  for (const table of RETENTION_TABLES) {
    if (!hasRetentionComment(sql, table)) failures.push(table + " is missing retention comment or partition metadata.");
  }

  for (const name of FORBIDDEN_LEGACY_OBJECT_NAMES) {
    if (createsLegacyObject(sql, name)) failures.push("Legacy object name is created instead of normalized: " + name + ".");
  }

  for (const missing of findMissingForeignKeyIndexes(sql)) {
    failures.push("Missing FK index on " + missing.table + "(" + missing.columns.join(", ") + ") referencing " + missing.references + ".");
  }

  for (const missing of findStatusColumnsWithoutCheck(sql)) {
    failures.push("Status column lacks a check constraint: " + missing.table + "." + missing.column + ".");
  }

  if (/create\s+schema\s+(?:if\s+not\s+exists\s+)?apic_gateway\b/i.test(sql)) failures.push("Phase 1 migration must not create apic_gateway schema.");
  if (/create\s+schema\s+(?:if\s+not\s+exists\s+)?shared_core\b/i.test(sql)) failures.push("Phase 1 migration must not create shared_core schema.");
  if (/\b(?:create|alter|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?shared_[a-z0-9_]+/i.test(sql)) failures.push("Phase 1 migration must not create, alter, or drop shared_* provider tables.");
  if (/\bgrant\s+[^;]+\s+on\s+[^;]*apic_[^;]+\s+to\s+(?:anon|authenticated)\b/i.test(sql)) failures.push("Private APIC schema grants to anon/authenticated are forbidden.");

  for (const schema of CONTROLLED_SCHEMAS) {
    if (!hasPublicRevoke(sql, schema)) failures.push("Missing public revoke for schema " + schema + ".");
  }
  if (!/revoke\s+delete\s+on\s+(?:all\s+tables\s+in\s+schema\s+apic_audit|apic_audit\.audit_events)\s+from\s+api_center_app\b/i.test(sql)) {
    failures.push("Missing audit delete denial for api_center_app.");
  }

  return failures;
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readApiSchemasFromConfig(content) {
  const schemas = [];
  let inApi = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inApi = line === "[api]";
      continue;
    }
    if (!inApi || !line.startsWith("schemas")) continue;
    for (const match of line.matchAll(/["\']([^"\']+)["\']/g)) schemas.push(match[1]);
  }
  return schemas;
}

function hasCreateIndex(sql, name) {
  return new RegExp("create\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?" + escapeRegex(name) + "\\b", "i").test(sql);
}

function hasCheckConstraint(sql, name) {
  return new RegExp("constraint\\s+" + escapeRegex(name) + "\\s+check\\s*\\(", "i").test(sql) ||
    new RegExp("rename\\s+constraint\\s+[^;]+\\s+to\\s+" + escapeRegex(name) + "\\b", "i").test(sql);
}

function hasRetentionComment(sql, table) {
  return new RegExp("comment\\s+on\\s+table\\s+" + escapeRegex(table) + "\\s+is\\s+[^;]*retention=", "i").test(sql) ||
    new RegExp("create\\s+table[^;]+partition\\s+by[^;]+" + escapeRegex(table), "i").test(sql);
}

function createsLegacyObject(sql, name) {
  return new RegExp("create\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?" + escapeRegex(name) + "\\b", "i").test(sql) ||
    new RegExp("constraint\\s+" + escapeRegex(name) + "\\s+check\\s*\\(", "i").test(sql);
}

function hasPublicRevoke(sql, schema) {
  return new RegExp("revoke\\s+all\\s+on\\s+schema[^;]+" + escapeRegex(schema) + "[^;]+from\\s+public", "i").test(sql) ||
    new RegExp("revoke\\s+all\\s+on\\s+all\\s+tables\\s+in\\s+schema\\s+" + escapeRegex(schema) + "\\s+from\\s+public", "i").test(sql);
}

function findMissingForeignKeyIndexes(sql) {
  const foreignKeys = extractForeignKeys(sql);
  const indexes = extractLeadingColumnIndexes(sql);
  return foreignKeys.filter((foreignKey) => !isForeignKeyIndexed(foreignKey, indexes));
}

function findStatusColumnsWithoutCheck(sql) {
  const missing = [];
  for (const table of extractCreateTables(sql)) {
    const definitions = splitSqlDefinitions(table.body);
    for (const definition of definitions) {
      const column = definition.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
      if (!column || column[1] !== "status") continue;
      if (!/\bconstraint\s+[a-zA-Z_][a-zA-Z0-9_]*\s+check\s*\(/i.test(definition)) {
        missing.push({ table: table.name, column: column[1] });
      }
    }
  }
  return missing;
}

function extractForeignKeys(sql) {
  const foreignKeys = [];
  for (const table of extractCreateTables(sql)) {
    const definitions = splitSqlDefinitions(table.body);
    for (const line of definitions) {
      const inline = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+[\s\S]*?\breferences\s+([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)/i);
      if (inline) foreignKeys.push({ table: table.name, columns: [inline[1]], references: inline[2] + "(" + normalizeColumnList(inline[3]).join(", ") + ")" });
      const tableLevel = line.match(/\bforeign\s+key\s*\(([^)]+)\)\s+references\s+([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)/i);
      if (tableLevel) foreignKeys.push({ table: table.name, columns: normalizeColumnList(tableLevel[1]), references: tableLevel[2] + "(" + normalizeColumnList(tableLevel[3]).join(", ") + ")" });
    }
  }
  return foreignKeys;
}

function extractLeadingColumnIndexes(sql) {
  const byTable = new Map();
  for (const table of extractCreateTables(sql)) {
    for (const columns of extractConstraintIndexColumns(table.body)) addIndexColumns(byTable, table.name, columns);
  }
  const indexPattern = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?[a-zA-Z_][a-zA-Z0-9_]*\s+on\s+([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^;]+?)\)\s*;/gi;
  for (const match of sql.matchAll(indexPattern)) addIndexColumns(byTable, normalizeTableName(match[1]), normalizeColumnList(match[2]));
  return byTable;
}

function extractCreateTables(sql) {
  const tables = [];
  const tablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\);/gi;
  for (const match of sql.matchAll(tablePattern)) tables.push({ name: normalizeTableName(match[1]), body: match[2] });
  return tables;
}

function extractConstraintIndexColumns(body) {
  const columns = [];
  for (const line of splitSqlDefinitions(body)) {
    const inlinePrimary = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+[\s\S]*?\bprimary\s+key\b/i);
    if (inlinePrimary) columns.push([inlinePrimary[1]]);
    const inlineUnique = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+[\s\S]*?\bunique\b/i);
    if (inlineUnique) columns.push([inlineUnique[1]]);
    const tablePrimary = line.match(/\bprimary\s+key\s*\(([^)]+)\)/i);
    if (tablePrimary) columns.push(normalizeColumnList(tablePrimary[1]));
    const tableUnique = line.match(/\bunique\s*\(([^)]+)\)/i);
    if (tableUnique) columns.push(normalizeColumnList(tableUnique[1]));
  }
  return columns;
}


function splitSqlDefinitions(body) {
  const definitions = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const prev = body[index - 1];
    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) definitions.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) definitions.push(trimmed);
  return definitions;
}

function addIndexColumns(byTable, table, columns) {
  if (!columns.length) return;
  const normalized = normalizeTableName(table);
  const existing = byTable.get(normalized) || [];
  existing.push(columns.map(normalizeIndexedColumn));
  byTable.set(normalized, existing);
}

function isForeignKeyIndexed(foreignKey, indexes) {
  const tableIndexes = indexes.get(normalizeTableName(foreignKey.table)) || [];
  const columns = foreignKey.columns.map(normalizeIndexedColumn);
  return tableIndexes.some((indexColumns) => columns.every((column, index) => indexColumns[index] === column));
}

function normalizeColumnList(value) {
  return value.split(",").map(normalizeIndexedColumn).filter(Boolean);
}

function normalizeIndexedColumn(value) {
  return value.trim().replace(/^"|"$/g, "").replace(/\s+(?:asc|desc)\b.*$/i, "").replace(/\s+nulls\s+(?:first|last)\b.*$/i, "").trim();
}

function normalizeTableName(value) {
  return value.trim().replace(/"/g, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const failures = runStaticEnterpriseMigrationChecks();
  if (failures.length) {
    console.error("Static enterprise migration verification failed:\n");
    for (const failure of failures) console.error("- " + failure);
    process.exit(1);
  }
  console.log("Static enterprise migration verification passed.");
}

module.exports = { runStaticEnterpriseMigrationChecks, extractForeignKeys, findMissingForeignKeyIndexes, findStatusColumnsWithoutCheck };

if (require.main === module) main();
