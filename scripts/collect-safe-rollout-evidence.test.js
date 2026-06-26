const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectSafeRolloutEvidence,
  writeSafeRolloutEvidence,
} = require("./collect-safe-rollout-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-safe-rollout-evidence-"));
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

run("marks safe rollout ready when all expected env values match", () => {
  withTempRepo({
    "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
    "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
  }, (repoRoot) => {
    const evidence = collectSafeRolloutEvidence({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      env: {
        DATABASE_ENABLED: "true",
        DATABASE_DUAL_WRITE: "true",
        REGISTRY_SOURCE: "redis",
        REGISTRY_DUAL_WRITE: "true",
      },
    });
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
    assert.equal(evidence.supabase.projectRef, "qnebjcboppqdsgmgizvs");
    assert.equal(JSON.stringify(evidence).includes("redis"), true);
    assert.equal(JSON.stringify(evidence).includes("DATABASE_URL"), false);
  });
});

run("records missing env blockers without leaking values", () => {
  const evidence = collectSafeRolloutEvidence({ repoRoot: "C:/repo", now: "2026-06-26T00:00:00.000Z", env: {} });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("DATABASE_ENABLED is not set for safe rollout mode."), true);
  assert.equal(evidence.environment.DATABASE_ENABLED.present, false);
});

run("records mismatched env blockers", () => {
  const evidence = collectSafeRolloutEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: {
      DATABASE_ENABLED: "true",
      DATABASE_DUAL_WRITE: "false",
      REGISTRY_SOURCE: "postgres",
      REGISTRY_DUAL_WRITE: "true",
    },
  });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("DATABASE_DUAL_WRITE must be true for safe rollout mode."), true);
  assert.equal(evidence.blockers.includes("REGISTRY_SOURCE must be redis for safe rollout mode."), true);
  assert.equal(evidence.environment.REGISTRY_SOURCE.redactedValue, "<present>");
});

run("writes safe rollout evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "safe-rollout.json");
    const evidence = collectSafeRolloutEvidence({ repoRoot, env: {} });
    writeSafeRolloutEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.expectedSafeRolloutEnv.REGISTRY_SOURCE, "redis");
  });
});
