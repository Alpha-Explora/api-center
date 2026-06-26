#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIGRATION = "supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql";
const DEFAULT_ROLE_DISCOVERY = "docs/operations/supabase-role-discovery-2026-06-26.json";
const FORBIDDEN_DYNAMIC_ROLE_PATTERNS = [
  { id: "candidate_count", pattern: /\bcandidate_count\b/i },
  { id: "role_table_grants", pattern: /\binformation_schema\.role_table_grants\b/i },
  { id: "dynamic_role_loop", pattern: /\bfor\s+\w*role\w*\s+in\s+select\b/i },
  { id: "limit_role_selection", pattern: /\bselect\b[\s\S]{0,120}\brolname\b[\s\S]{0,160}\blimit\s+1\b/i },
];
const APIC_SCHEMA_PATTERN = /\b(?:apic_catalog|apic_governance|apic_runtime|apic_audit|api_center|api_center_ops|api_center_audit)\b/i;

function collectGrantAlignmentEvidence({ repoRoot = path.resolve(__dirname, ".."), migrationPath = DEFAULT_MIGRATION, roleDiscoveryPath = DEFAULT_ROLE_DISCOVERY, now = new Date().toISOString() } = {}) {
  const migrationRel = normalizeRel(migrationPath);
  const roleDiscoveryRel = normalizeRel(roleDiscoveryPath);
  const migration = readText(repoRoot, migrationRel);
  const roleDiscovery = readJson(repoRoot, roleDiscoveryRel);
  const blockers = [];

  if (!migration.present) blockers.push("Migration SQL is missing: " + migrationRel);
  if (!roleDiscovery.present) blockers.push("Role discovery artifact is missing: " + roleDiscoveryRel);

  const migrationSql = migration.content || "";
  const roleData = roleDiscovery.data || {};
  const discoveryBlockers = Array.isArray(roleData.blockers) ? roleData.blockers : [];
  const discoveredRoles = Array.isArray(roleData.recommendedAppRoles) ? roleData.recommendedAppRoles : [];
  const explicitGrantRoles = extractExplicitGrantRoles(migrationSql);
  const forbiddenDynamicRoleDiscovery = findForbiddenDynamicRoleDiscovery(migrationSql);
  const missingDiscoveredRoles = explicitGrantRoles.filter((role) => !discoveredRoles.includes(role));
  const unmanagedDiscoveredRoles = discoveredRoles.filter((role) => !explicitGrantRoles.includes(role));

  for (const blocker of discoveryBlockers) blockers.push("Role discovery blocker: " + blocker);
  if (explicitGrantRoles.length === 0 && migration.present) blockers.push("No explicit app grant role was found in APIC migration DDL.");
  if (forbiddenDynamicRoleDiscovery.length > 0) blockers.push("Migration DDL contains forbidden dynamic role-selection patterns: " + forbiddenDynamicRoleDiscovery.join(", ") + ".");
  if (roleDiscovery.present && discoveredRoles.length === 0) blockers.push("Role discovery did not recommend any runtime app roles.");
  if (missingDiscoveredRoles.length > 0) blockers.push("Migration grants target role(s) not proven by role discovery: " + missingDiscoveredRoles.join(", ") + ".");
  if (unmanagedDiscoveredRoles.length > 0) blockers.push("Role discovery found runtime app role(s) not covered by migration grants: " + unmanagedDiscoveredRoles.join(", ") + ".");

  return {
    generatedAt: now,
    repoRoot,
    artifacts: {
      migration: { path: migrationRel, present: migration.present },
      roleDiscovery: { path: roleDiscoveryRel, present: roleDiscovery.present },
    },
    migrationGrantRoles: explicitGrantRoles,
    discoveredAppRoles: discoveredRoles,
    forbiddenDynamicRoleDiscovery,
    missingDiscoveredRoles,
    unmanagedDiscoveredRoles,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Run npm run db:discover:roles against the live DATABASE_URL.",
      "Update migration grant targets only from the discovered app role list.",
      "Rerun npm run db:grant-alignment:evidence before live approval.",
    ],
  };
}

function extractExplicitGrantRoles(sql) {
  const roles = new Set();
  const statements = sql.split(";");
  for (const statement of statements) {
    if (!APIC_SCHEMA_PATTERN.test(statement)) continue;
    for (const role of extractRolesFromStatement(statement)) {
      if (["public", "anon", "authenticated"].includes(role.toLowerCase())) continue;
      roles.add(role);
    }
  }
  return Array.from(roles).sort();
}

function extractRolesFromStatement(statement) {
  const roles = [];
  const patterns = [
    /\bgrant\b[\s\S]+?\bto\s+([^;]+)/i,
    /\brevoke\b[\s\S]+?\bfrom\s+([^;]+)/i,
    /\balter\s+default\s+privileges\b[\s\S]+?\bto\s+([^;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = statement.match(pattern);
    if (!match) continue;
    for (const role of splitRoleList(match[1])) roles.push(role);
  }
  return roles;
}

function splitRoleList(value) {
  return value
    .replace(/\s+with\s+grant\s+option\b[\s\S]*$/i, "")
    .split(",")
    .map((role) => role.trim().replace(/^"|"$/g, ""))
    .map((role) => role.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) ? role : "")
    .filter(Boolean);
}

function findForbiddenDynamicRoleDiscovery(sql) {
  return FORBIDDEN_DYNAMIC_ROLE_PATTERNS.filter((entry) => entry.pattern.test(sql)).map((entry) => entry.id);
}

function readText(repoRoot, relPath) {
  try {
    return { present: true, content: fs.readFileSync(path.join(repoRoot, relPath), "utf8") };
  } catch (error) {
    if (error && error.code === "ENOENT") return { present: false };
    throw error;
  }
}

function readJson(repoRoot, relPath) {
  const result = readText(repoRoot, relPath);
  if (!result.present) return { present: false };
  return { present: true, data: JSON.parse(result.content) };
}

function normalizeRel(value) {
  return value.replace(/\\/g, "/");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = argv[++index];
    else if (arg === "--migration") options.migrationPath = argv[++index];
    else if (arg === "--role-discovery") options.roleDiscoveryPath = argv[++index];
    else if (arg === "--fail-on-blockers") options.failOnBlockers = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const evidence = collectGrantAlignmentEvidence({ repoRoot, migrationPath: options.migrationPath || DEFAULT_MIGRATION, roleDiscoveryPath: options.roleDiscoveryPath || DEFAULT_ROLE_DISCOVERY });
  if (options.out) {
    const outPath = path.resolve(repoRoot, options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  if (options.failOnBlockers && !evidence.ready) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { collectGrantAlignmentEvidence, extractExplicitGrantRoles, findForbiddenDynamicRoleDiscovery };
