const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectGrantAlignmentEvidence, extractExplicitGrantRoles, findForbiddenDynamicRoleDiscovery } = require("./collect-grant-alignment-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-grant-alignment-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const migrationSql = [
  "grant usage on schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app;",
  "grant select, insert, update on all tables in schema apic_catalog to api_center_app;",
  "revoke delete on all tables in schema apic_audit from api_center_app;",
  "alter default privileges in schema apic_runtime grant select, insert, update on tables to api_center_app;",
  "revoke all on schema apic_catalog from public;",
].join("\n");

run("extracts explicit APIC grant roles", () => {
  assert.deepEqual(extractExplicitGrantRoles(migrationSql), ["api_center_app"]);
});

run("detects forbidden dynamic role discovery", () => {
  assert.deepEqual(findForbiddenDynamicRoleDiscovery("select candidate_count from information_schema.role_table_grants;"), ["candidate_count", "role_table_grants"]);
});

run("passes when grant roles match discovered roles", () => {
  withTempRepo({
    "migration.sql": migrationSql,
    "roles.json": { blockers: [], recommendedAppRoles: ["api_center_app"] },
  }, (repoRoot) => {
    const evidence = collectGrantAlignmentEvidence({ repoRoot, migrationPath: "migration.sql", roleDiscoveryPath: "roles.json", now: "2026-06-26T00:00:00.000Z" });
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
  });
});

run("blocks when role discovery has blockers", () => {
  withTempRepo({
    "migration.sql": migrationSql,
    "roles.json": { blockers: ["DATABASE_URL is not set"], recommendedAppRoles: [] },
  }, (repoRoot) => {
    const evidence = collectGrantAlignmentEvidence({ repoRoot, migrationPath: "migration.sql", roleDiscoveryPath: "roles.json" });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("DATABASE_URL is not set")), true);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("api_center_app")), true);
  });
});

run("blocks when migration grant roles differ from discovered roles", () => {
  withTempRepo({
    "migration.sql": migrationSql,
    "roles.json": { blockers: [], recommendedAppRoles: ["api_center_runtime"] },
  }, (repoRoot) => {
    const evidence = collectGrantAlignmentEvidence({ repoRoot, migrationPath: "migration.sql", roleDiscoveryPath: "roles.json" });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.missingDiscoveredRoles.includes("api_center_app"), true);
    assert.equal(evidence.unmanagedDiscoveredRoles.includes("api_center_runtime"), true);
  });
});

run("blocks forbidden dynamic role selection", () => {
  withTempRepo({
    "migration.sql": migrationSql + "\nselect candidate_count from information_schema.role_table_grants;",
    "roles.json": { blockers: [], recommendedAppRoles: ["api_center_app"] },
  }, (repoRoot) => {
    const evidence = collectGrantAlignmentEvidence({ repoRoot, migrationPath: "migration.sql", roleDiscoveryPath: "roles.json" });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.forbiddenDynamicRoleDiscovery.includes("candidate_count"), true);
    assert.equal(evidence.forbiddenDynamicRoleDiscovery.includes("role_table_grants"), true);
  });
});
