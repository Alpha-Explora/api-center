const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectDryRunEvidence,
  writeDryRunEvidence,
  sanitize,
} = require("./collect-supabase-dry-run-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-dry-run-evidence-"));
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

function fakeRunner(command, args) {
  const joined = [command, ...args].join(" ");
  if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
  if (joined === "supabase db push --help") {
    return { command: joined, status: 0, stdout: "Push migrations. Flags: --dry-run --linked --db-url\n", stderr: "" };
  }
  if (joined === "supabase db push --dry-run --linked") {
    return { command: joined, status: 0, stdout: "Would apply migration 20260625162216\n", stderr: "" };
  }
  return { command: joined, status: 1, stdout: "", stderr: "unknown command" };
}

run("marks dry-run evidence ready when backup exists and dry-run command succeeds", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
      "docs/operations/backup-evidence.json": JSON.stringify({
        ready: true,
        backupFile: { path: "docs/operations/backup.sql", present: true },
        schemas: ["api_center", "shared_payment"],
      }),
    },
    (repoRoot) => {
      const evidence = collectDryRunEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
        runDryRun: true,
        backupEvidencePath: "docs/operations/backup-evidence.json",
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.blockers, []);
      assert.equal(evidence.cli.supportsDryRun, true);
      assert.equal(evidence.backupEvidence.backupFilePresent, true);
      assert.equal(evidence.dryRun.status, 0);
      assert.equal(JSON.stringify(evidence).includes("sbp_supersecret"), false);
      assert.equal(JSON.stringify(evidence).includes("db-secret"), false);
    },
  );
});

run("records blockers when backup and live prerequisites are missing", () => {
  withTempRepo(
    { "supabase/config.toml": "project_id = \"api-center-control-plane\"\n" },
    (repoRoot) => {
      const evidence = collectDryRunEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
        backupEvidencePath: "docs/operations/missing-backup.json",
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.blockers.includes("supabase/.temp/project-ref is not present."), true);
      assert.equal(evidence.blockers.some((blocker) => blocker.includes("Backup evidence file is missing")), true);
      assert.equal(evidence.blockers.some((blocker) => blocker.includes("supabase db push --dry-run was not run")), true);
    },
  );
});

run("blocks when backup evidence exists but no dump file is proven", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
      "docs/operations/backup-evidence.json": JSON.stringify({
        ready: false,
        backupFile: { path: "docs/operations/backup.sql", present: false },
      }),
    },
    (repoRoot) => {
      const evidence = collectDryRunEvidence({
        repoRoot,
        env: {},
        runner: fakeRunner,
        backupEvidencePath: "docs/operations/backup-evidence.json",
      });
      assert.equal(evidence.blockers.includes("Backup evidence does not prove a live dump file exists."), true);
    },
  );
});

run("sanitizes secrets from command output", () => {
  const output = sanitize(
    "token sbp_supersecret password=db-secret url postgresql://user:pass@example/postgres",
    { SUPABASE_ACCESS_TOKEN: "sbp_supersecret", SUPABASE_DB_PASSWORD: "db-secret" },
  );
  assert.equal(output.includes("sbp_supersecret"), false);
  assert.equal(output.includes("db-secret"), false);
  assert.equal(output.includes("postgresql://user"), false);
});

run("writes dry-run evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "dry-run.json");
    const evidence = collectDryRunEvidence({ repoRoot, env: {}, runner: fakeRunner });
    writeDryRunEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.cli.supportsDryRun, true);
  });
});
