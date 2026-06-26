#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_COMPATIBILITY_VIEW_DROPS = [
  "api_center_audit.audit_events",
  "api_center_ops.pipeline_feedback_actions",
  "api_center_ops.tribe_api_quota_decisions",
  "api_center_ops.usage_rollups",
  "api_center_ops.smoke_test_runs",
  "api_center_ops.health_snapshots",
  "api_center_ops.topic_onboarding_states",
  "api_center_ops.provisioning_jobs",
  "api_center_ops.tribe_plan_assignments",
  "api_center_ops.tribe_plan_definitions",
  "api_center_ops.tribe_api_quota_policies",
  "api_center_ops.approval_requests",
  "api_center_ops.service_registration_requests",
  "api_center.s3_sink_topics",
  "api_center.confluent_topics",
  "api_center.tribe_secret_refs",
  "api_center.service_lifecycle_events",
  "api_center.service_dependencies",
  "api_center.service_scopes",
  "api_center.service_routes",
  "api_center.service_environments",
  "api_center.services",
  "api_center.organizations",
];

const REQUIRED_EMPTY_SCHEMA_DROPS = [
  "api_center_audit",
  "api_center_ops",
  "api_center",
];

function runCompatCleanupMigrationChecks({ repoRoot = path.resolve(__dirname, "..") } = {}) {
  const failures = [];
  const migrationPath = findCleanupMigration(repoRoot);
  if (!migrationPath) return ["Cleanup migration is missing: supabase/migrations/*_drop_legacy_control_plane_views.sql."];

  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const view of REQUIRED_COMPATIBILITY_VIEW_DROPS) {
    if (!hasDropView(sql, view)) failures.push("Missing compatibility-view drop: " + view + ".");
  }
  for (const schema of REQUIRED_EMPTY_SCHEMA_DROPS) {
    if (!hasDropSchema(sql, schema)) failures.push("Missing empty legacy-schema drop: " + schema + ".");
  }
  for (const forbidden of findForbiddenStatements(sql)) {
    failures.push("Forbidden cleanup SQL: " + forbidden + ".");
  }
  return failures;
}

function findCleanupMigration(repoRoot) {
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  if (!fs.existsSync(migrationsDir)) return undefined;
  const matches = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d+_drop_legacy_control_plane_views\.sql$/.test(name))
    .sort();
  if (!matches.length) return undefined;
  return path.join(migrationsDir, matches[matches.length - 1]);
}

function hasDropView(sql, view) {
  return new RegExp("\\bdrop\\s+view\\s+if\\s+exists\\s+" + escapeRegex(view) + "\\s*;", "i").test(sql);
}

function hasDropSchema(sql, schema) {
  return new RegExp("\\bdrop\\s+schema\\s+if\\s+exists\\s+" + escapeRegex(schema) + "\\s*;", "i").test(sql);
}

function findForbiddenStatements(sql) {
  const forbidden = [];
  const statementPattern = /(?:^|;)\s*((?:create|alter|grant|revoke|truncate)\b[^;]*|\bdrop\s+(?!view\b)[^;]*)/gi;
  for (const match of sql.matchAll(statementPattern)) {
    const statement = match[1].replace(/\s+/g, " ").trim();
    if (isAllowedDropSchema(statement)) continue;
    if (statement) forbidden.push(statement.slice(0, 180));
  }
  return forbidden;
}

function isAllowedDropSchema(statement) {
  const match = statement.match(/^drop\s+schema\s+if\s+exists\s+([a-z_][a-z0-9_]*)\s*$/i);
  if (!match) return false;
  return REQUIRED_EMPTY_SCHEMA_DROPS.includes(match[1]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const failures = runCompatCleanupMigrationChecks();
  if (failures.length) {
    console.error("Compatibility cleanup migration verification failed:\n");
    for (const failure of failures) console.error("- " + failure);
    process.exit(1);
  }
  console.log("Compatibility cleanup migration verification passed.");
}

module.exports = {
  REQUIRED_COMPATIBILITY_VIEW_DROPS,
  REQUIRED_EMPTY_SCHEMA_DROPS,
  findCleanupMigration,
  runCompatCleanupMigrationChecks,
  findForbiddenStatements,
};

if (require.main === module) main();
