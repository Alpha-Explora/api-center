const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectVerifierEvidence,
  writeVerifierEvidence,
  readDiscoveredRole,
  sanitize,
} = require("./collect-verifier-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-verifier-evidence-"));
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

function runner(command, args) {
  const joined = [command, ...args].join(" ").replace(/^npm\.cmd\b/i, "npm");
  if (joined === "npm run db:verify:enterprise-static") return { command: joined, status: 0, stdout: "Static enterprise migration verification passed.", stderr: "" };
  if (joined.startsWith("npm run db:verify:control-plane") || joined.includes("verify-control-plane-schema.ts")) return { command: joined, status: 0, stdout: "Control-plane schema verification passed.", stderr: "" };
  return { command: joined, status: 1, stdout: "", stderr: "unknown" };
}

run("records static pass and blocks live modes without DATABASE_URL or app role", () => {
  withTempRepo({}, (repoRoot) => {
    const evidence = collectVerifierEvidence({ repoRoot, env: {}, now: "2026-06-26T00:00:00.000Z", runner, staticChecker: () => [] });
    assert.equal(evidence.staticRun.status, 0);
    assert.equal(evidence.liveRuns.length, 0);
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("DATABASE_URL is not set."), true);
    assert.equal(evidence.blockers.includes("No app role was supplied or discovered."), true);
  });
});

run("discovers app role from role evidence and runs all live modes", () => {
  withTempRepo({ "docs/operations/roles.json": { recommendedAppRoles: ["api_center_app"] } }, (repoRoot) => {
    const evidence = collectVerifierEvidence({
      repoRoot,
      env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
      roleDiscoveryPath: "docs/operations/roles.json",
      now: "2026-06-26T00:00:00.000Z",
      runner,
      staticChecker: () => [],
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.appRole, "api_center_app");
    assert.deepEqual(evidence.liveRuns.map((run) => run.id), ["base", "compat_views", "retention_policy"]);
    assert.equal(JSON.stringify(evidence).includes("postgresql://user"), false);
  });
});

run("uses legacy-schema absence instead of compatibility views after cleanup", () => {
  withTempRepo({ "docs/operations/roles.json": { recommendedAppRoles: ["api_center_app"] } }, (repoRoot) => {
    const evidence = collectVerifierEvidence({
      repoRoot,
      env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
      roleDiscoveryPath: "docs/operations/roles.json",
      now: "2026-06-26T00:00:00.000Z",
      runner,
      staticChecker: () => [],
      postCompatibilityCleanup: true,
    });

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.liveRuns.map((run) => run.id), ["base", "legacy_schemas_absent", "retention_policy"]);
    assert.equal(JSON.stringify(evidence).includes("--require-compat-views"), false);
    assert.equal(JSON.stringify(evidence).includes("--forbid-legacy-schemas"), true);
  });
});

run("records failed live verifier mode as blocker", () => {
  const evidence = collectVerifierEvidence({
    repoRoot: "C:/repo",
    env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
    appRole: "api_center_app",
    runner: (command, args) => {
      const joined = [command, ...args].join(" ").replace(/^npm\.cmd\b/i, "npm");
      if (joined === "npm run db:verify:enterprise-static") return { command: joined, status: 0, stdout: "ok", stderr: "" };
      if (joined.includes("--require-compat-views")) return { command: joined, status: 1, stdout: "", stderr: "missing view postgresql://user:secret@example/postgres" };
      return { command: joined, status: 0, stdout: "ok", stderr: "" };
    },
  });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("Live verifier mode failed: compat_views."), true);
    assert.equal(evidence.liveRuns.find((run) => run.id === "compat_views").result.stderr.includes("postgresql://user"), false);
});

run("supports intentionally skipping live verifier execution", () => {
  const evidence = collectVerifierEvidence({
    repoRoot: "C:/repo",
    env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
    appRole: "api_center_app",
    runLive: false,
    runner,
    staticChecker: () => [],
  });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.some((blocker) => blocker.includes("Live verifier modes were not run")), true);
});

run("reads discovered role and writes evidence", () => {
  withTempRepo({ "docs/operations/roles.json": { recommendedAppRoles: ["api_center_app"] } }, (repoRoot) => {
    assert.equal(readDiscoveredRole(path.join(repoRoot, "docs", "operations", "roles.json")), "api_center_app");
    const out = path.join(repoRoot, "docs", "operations", "verifier.json");
    writeVerifierEvidence(collectVerifierEvidence({ repoRoot, env: {}, runner, staticChecker: () => [] }), out);
    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(written.staticRun.status, 0);
  });
});


run("records static checker failures", () => {
  const evidence = collectVerifierEvidence({
    repoRoot: "C:/repo",
    env: {},
    runner,
    staticChecker: () => ["missing index"],
  });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.staticRun.status, 1);
  assert.equal(evidence.blockers.includes("Static enterprise migration verifier failed."), true);
  assert.equal(evidence.staticRun.stderr.includes("missing index"), true);
});

run("sanitizes database urls and password assignments", () => {
  const output = sanitize("url postgresql://user:secret@example/postgres password=secret2", {
    DATABASE_URL: "postgresql://user:secret@example/postgres",
  });
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("secret2"), false);
});
