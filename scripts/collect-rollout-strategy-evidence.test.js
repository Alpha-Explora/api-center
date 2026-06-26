const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  COMPATIBILITY_VIEW_NAMES,
  collectRolloutStrategyEvidence,
  inspectCompatibilityViews,
  writeRolloutStrategyEvidence,
} = require("./collect-rollout-strategy-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-rollout-strategy-"));
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

function compatibilitySql() {
  return COMPATIBILITY_VIEW_NAMES.map((view) => "create or replace view " + view + " with (security_invoker = true) as select 1 as id;").join("\n");
}

run("marks compatibility-view rollout ready when approved and all views exist", () => {
  withTempRepo({ "supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql": compatibilitySql() }, (repoRoot) => {
    const evidence = collectRolloutStrategyEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: {
        APICENTER_MIGRATION_ROLLOUT_STRATEGY: "compatibility_views",
        APICENTER_COMPATIBILITY_VIEWS_APPROVED: "true",
      },
    });
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
    assert.equal(evidence.compatibilityViews.found.length, COMPATIBILITY_VIEW_NAMES.length);
  });
});

run("blocks compatibility-view rollout when approval or security-invoker views are missing", () => {
  withTempRepo({ "supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql": "create or replace view api_center.services as select 1 as id;" }, (repoRoot) => {
    const evidence = collectRolloutStrategyEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: { APICENTER_MIGRATION_ROLLOUT_STRATEGY: "compatibility_views" },
    });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("Compatibility-view rollout is not approved; set APICENTER_COMPATIBILITY_VIEWS_APPROVED=true."), true);
    assert.equal(evidence.blockers.includes("Compatibility view is missing security_invoker=true: api_center.services."), true);
    assert.equal(evidence.compatibilityViews.missing.includes("api_center.organizations"), true);
  });
});

run("marks controlled-window rollout ready only with approval and window bounds", () => {
  const evidence = collectRolloutStrategyEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: {
      APICENTER_MIGRATION_ROLLOUT_STRATEGY: "controlled_window",
      APICENTER_CONTROLLED_MIGRATION_WINDOW_APPROVED: "approved",
      APICENTER_MIGRATION_WINDOW_START: "2026-06-26T01:00:00Z",
      APICENTER_MIGRATION_WINDOW_END: "2026-06-26T02:00:00Z",
    },
  });
  assert.equal(evidence.ready, true);
  assert.deepEqual(evidence.blockers, []);
});

run("blocks missing or invalid rollout strategy", () => {
  const missing = collectRolloutStrategyEvidence({ repoRoot: "C:/repo", env: {} });
  assert.equal(missing.ready, false);
  assert.equal(missing.blockers.includes("APICENTER_MIGRATION_ROLLOUT_STRATEGY or SUPABASE_MIGRATION_ROLLOUT_STRATEGY is not set."), true);

  const invalid = collectRolloutStrategyEvidence({ repoRoot: "C:/repo", env: { APICENTER_MIGRATION_ROLLOUT_STRATEGY: "hot_swap" } });
  assert.equal(invalid.blockers.includes("Migration rollout strategy must be compatibility_views or controlled_window."), true);
});

run("inspects repository migration compatibility views", () => {
  const result = inspectCompatibilityViews(path.join(__dirname, "..", "supabase", "migrations", "20260625162216_enterprise_control_plane_schemas.sql"));
  assert.equal(result.present, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingSecurityInvoker, []);
});

run("writes rollout strategy evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "rollout.json");
    const evidence = collectRolloutStrategyEvidence({ repoRoot, env: {} });
    writeRolloutStrategyEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.ready, false);
  });
});
