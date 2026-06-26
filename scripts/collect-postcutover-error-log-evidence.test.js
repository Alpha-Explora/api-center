const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectPostcutoverErrorLogEvidence,
  scanSource,
  sanitize,
  writePostcutoverErrorLogEvidence,
} = require("./collect-postcutover-error-log-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-postcutover-log-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const filePath = path.join(root, relative);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run("blocks when no log source is configured", () => {
  const evidence = collectPostcutoverErrorLogEvidence({
    now: "2026-06-26T00:00:00.000Z",
    env: {},
  });

  assert.equal(evidence.ready, false);
  assert.deepEqual(evidence.blockers, [
    "No API Center post-cutover log source was provided; set API_CENTER_LOG_FILE or API_CENTER_LOG_DIR.",
  ]);
});

run("passes when log source has no post-cutover error patterns", () => {
  withTempRepo({ "logs/api.log": "registry parity ok\naudit dual-write completed\n" }, (repoRoot) => {
    const evidence = collectPostcutoverErrorLogEvidence({
      repoRoot,
      env: { API_CENTER_LOG_FILE: "logs/api.log" },
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.sources[0].matchCount, 0);
  });
});

run("detects audit dual-write and Prisma query errors", () => {
  withTempRepo({
    "logs/api.log": [
      "AuditEventsService failed to persist audit dual-write to postgres",
      "PrismaClientKnownRequestError P2021 table does not exist",
      "database query ETIMEDOUT postgres pool",
    ].join("\n"),
  }, (repoRoot) => {
    const evidence = collectPostcutoverErrorLogEvidence({
      repoRoot,
      env: { API_CENTER_LOG_FILE: "logs/api.log" },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.sources[0].matchCount, 3);
    assert.deepEqual(
      evidence.sources[0].matches.map((match) => match.pattern),
      ["audit_dual_write_failure", "prisma_query_error", "postgres_connection_or_query_error"],
    );
  });
});

run("scans log directories", () => {
  withTempRepo({
    "logs/api.log": "ok\n",
    "logs/api.out": "prisma query failed after migration\n",
    "logs/ignore.csv": "PrismaClientKnownRequestError\n",
  }, (repoRoot) => {
    const evidence = collectPostcutoverErrorLogEvidence({
      repoRoot,
      env: { API_CENTER_LOG_DIR: "logs" },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.sources.length, 2);
    assert.equal(evidence.sources.reduce((sum, source) => sum + source.matchCount, 0), 1);
  });
});

run("reports missing file without throwing", () => {
  withTempRepo({}, (repoRoot) => {
    const evidence = collectPostcutoverErrorLogEvidence({
      repoRoot,
      env: { API_CENTER_LOG_FILE: "logs/missing.log" },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.sources[0].present, false);
  });
});

run("sanitizes snippets and writes evidence", () => {
  withTempRepo({
    "logs/api.log": "AuditEventsService failed password=hunter2 postgresql://user:pass@example/db sbp_token Bearer abc.def\n",
  }, (repoRoot) => {
    const evidence = collectPostcutoverErrorLogEvidence({
      repoRoot,
      env: { API_CENTER_LOG_FILE: "logs/api.log" },
    });
    const snippet = evidence.sources[0].matches[0].snippet;
    assert.equal(snippet.includes("hunter2"), false);
    assert.equal(snippet.includes("postgresql://user"), false);
    assert.equal(snippet.includes("sbp_token"), false);
    assert.equal(snippet.includes("abc.def"), false);

    const outPath = path.join(repoRoot, "out", "evidence.json");
    writePostcutoverErrorLogEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.ready, false);
  });
});

run("sanitize redacts direct values", () => {
  const output = sanitize("secret=top password=hunter2 redis://localhost postgresql://user:pass@example/db Bearer abc.def sbp_token");
  assert.equal(output.includes("secret=top"), false);
  assert.equal(output.includes("password=hunter2"), false);
  assert.equal(output.includes("redis://localhost"), false);
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("sbp_token"), false);
});
