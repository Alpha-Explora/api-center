const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  REQUIRED_COMPATIBILITY_VIEW_DROPS,
  REQUIRED_EMPTY_SCHEMA_DROPS,
  findCleanupMigration,
  runCompatCleanupMigrationChecks,
} = require("./check-compat-cleanup-migration.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compat-cleanup-static-"));
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

function validSql() {
  return [
    ...REQUIRED_COMPATIBILITY_VIEW_DROPS.map((view) => `drop view if exists ${view};`),
    ...REQUIRED_EMPTY_SCHEMA_DROPS.map((schema) => `drop schema if exists ${schema};`),
  ].join("\n");
}

run("passes when cleanup migration drops every compatibility view and empty legacy schema", () => {
  withTempRepo(
    { "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": validSql() },
    (repoRoot) => {
      assert.deepEqual(runCompatCleanupMigrationChecks({ repoRoot }), []);
    },
  );
});

run("fails when cleanup migration is missing", () => {
  withTempRepo({}, (repoRoot) => {
    assert.match(runCompatCleanupMigrationChecks({ repoRoot }).join("\n"), /Cleanup migration is missing/i);
  });
});

run("finds the newest generated cleanup migration", () => {
  withTempRepo(
    {
      "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": "-- old",
      "supabase/migrations/20260626000200_drop_legacy_control_plane_views.sql": "-- new",
    },
    (repoRoot) => {
      assert.equal(
        path.basename(findCleanupMigration(repoRoot)),
        "20260626000200_drop_legacy_control_plane_views.sql",
      );
    },
  );
});

run("fails when an expected drop view statement is missing", () => {
  const sql = validSql().replace("drop view if exists api_center.services;", "");
  withTempRepo(
    { "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": sql },
    (repoRoot) => {
      assert.match(runCompatCleanupMigrationChecks({ repoRoot }).join("\n"), /api_center\.services/);
    },
  );
});

run("fails when an expected empty schema drop is missing", () => {
  const sql = validSql().replace("drop schema if exists api_center_ops;", "");
  withTempRepo(
    { "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": sql },
    (repoRoot) => {
      assert.match(runCompatCleanupMigrationChecks({ repoRoot }).join("\n"), /api_center_ops/);
    },
  );
});

run("fails when cleanup migration includes non-view destructive DDL", () => {
  const sql = validSql() + "\ndrop table if exists apic_catalog.services;\n";
  withTempRepo(
    { "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": sql },
    (repoRoot) => {
      assert.match(runCompatCleanupMigrationChecks({ repoRoot }).join("\n"), /Forbidden cleanup SQL/i);
    },
  );
});

run("fails when cleanup migration drops legacy schemas with cascade", () => {
  const sql = validSql().replace("drop schema if exists api_center;", "drop schema if exists api_center cascade;");
  withTempRepo(
    { "supabase/migrations/20260626000100_drop_legacy_control_plane_views.sql": sql },
    (repoRoot) => {
      assert.match(runCompatCleanupMigrationChecks({ repoRoot }).join("\n"), /cascade/i);
    },
  );
});
