const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectMissingTableLogEvidence,
  sanitize,
  writeMissingTableLogEvidence,
} = require("./collect-missing-table-log-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-log-evidence-"));
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

run("blocks when no log source is provided", () => {
  const evidence = collectMissingTableLogEvidence({ repoRoot: "C:/repo", env: {}, now: "2026-06-26T00:00:00.000Z" });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("No API Center log source was provided; set API_CENTER_LOG_FILE or API_CENTER_LOG_DIR."), true);
});

run("marks evidence ready when a log file has no missing-table patterns", () => {
  withTempRepo({ "logs/api.log": "started ok\nready ok\n" }, (repoRoot) => {
    const evidence = collectMissingTableLogEvidence({ repoRoot, env: { API_CENTER_LOG_FILE: "logs/api.log" } });
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
    assert.equal(evidence.sources[0].matchCount, 0);
  });
});

run("detects and sanitizes missing-table patterns", () => {
  withTempRepo({
    "logs/api.log": "Prisma P2021: table api_center.services does not exist password=secret postgresql://user:pass@example/db\n42P01 relation api_center_ops.approval_requests does not exist Bearer abc.def\n",
  }, (repoRoot) => {
    const evidence = collectMissingTableLogEvidence({ repoRoot, env: { API_CENTER_LOG_FILE: "logs/api.log" } });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.sources[0].matchCount, 2);
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes("password=secret"), false);
    assert.equal(serialized.includes("postgresql://user"), false);
    assert.equal(serialized.includes("abc.def"), false);
  });
});

run("scans log directories", () => {
  withTempRepo({
    "logs/a.log": "ok",
    "logs/b.txt": "UndefinedTable relation api_center.foo does not exist",
    "logs/ignore.md": "relation api_center.bar does not exist",
  }, (repoRoot) => {
    const evidence = collectMissingTableLogEvidence({ repoRoot, env: { API_CENTER_LOG_DIR: "logs" } });
    assert.equal(evidence.sources.length, 2);
    assert.equal(evidence.sources.reduce((sum, source) => sum + source.matchCount, 0), 1);
  });
});

run("sanitizes sensitive strings", () => {
  const output = sanitize("redis://:pass@example Bearer abc.def password=secret secret=value sbp_token postgresql://u:p@h/db");
  assert.equal(output.includes("redis://"), false);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("password=secret"), false);
  assert.equal(output.includes("secret=value"), false);
  assert.equal(output.includes("sbp_token"), false);
  assert.equal(output.includes("postgresql://"), false);
});

run("writes missing-table log evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "logs.json");
    const evidence = collectMissingTableLogEvidence({ repoRoot, env: {} });
    writeMissingTableLogEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.ready, false);
  });
});
