const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectRowCountEvidence,
  writeRowCountEvidence,
  sanitize,
} = require("./collect-row-count-evidence.js");

async function run(name, fn) {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

async function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-row-count-evidence-"));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run("uses linked Supabase row-count query when DATABASE_URL is missing", async () => {
  const evidence = await collectRowCountEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: {},
    runner: (command, args) => ({
      command: [command, ...args].join(" "),
      status: 0,
      stdout: JSON.stringify({ rows: [{ table_schema: "api_center", table_name: "services", row_count: 12 }] }),
      stderr: "",
    }),
  });

  assert.equal(evidence.ready, true);
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.environment.DATABASE_URL.present, false);
  assert.equal(evidence.rowCountRun, undefined);
  assert.equal(evidence.linkedQueryRun.command.includes("supabase db query --linked"), true);
  assert.deepEqual(evidence.linkedRows, [{ table_schema: "api_center", table_name: "services", row_count: 12 }]);
});

run("runs verifier and sanitizes output when DATABASE_URL is present", async () => {
  const databaseUrl = "postgresql://user:password@example.supabase.co:5432/postgres";
  const evidence = await collectRowCountEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: { DATABASE_URL: databaseUrl },
    clientFactory: () => ({
      connect: async () => undefined,
      query: async () => ({ rows: [{ table_schema: "api_center", table_name: "services", row_count: 12 }] }),
      end: async () => undefined,
    }),
  });

  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.ready, true);
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.rowCountRun.status, 0);
  assert.equal(evidence.rowCountRun.command, "direct postgres row-count query");
  assert.equal(serialized.includes(databaseUrl), false);
  assert.equal(serialized.includes("api_center"), true);
  assert.equal(serialized.includes("services"), true);
});

run("records verifier failure as a blocker", async () => {
  const evidence = await collectRowCountEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: { DATABASE_URL: "postgresql://user:pass@example/postgres" },
    clientFactory: () => ({
      connect: async () => { throw new Error("connection failed for postgresql://user:pass@example/postgres"); },
      end: async () => undefined,
    }),
  });

  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("Direct row-count query did not complete successfully."), true);
  assert.equal(String(evidence.rowCountRun.error || "").includes("postgresql://user"), false);
});

run("can intentionally skip verifier execution", async () => {
  const evidence = await collectRowCountEvidence({
    repoRoot: "C:/repo",
    now: "2026-06-26T00:00:00.000Z",
    env: { DATABASE_URL: "postgresql://user:pass@example/postgres" },
    runRowCounts: false,
  });

  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.some((blocker) => blocker.includes("Row-count verifier was not run")), true);
});

run("sanitizes database connection strings", () => {
  const output = sanitize(
    "DATABASE_URL=postgresql://user:secret@example/postgres password=secret2",
    { DATABASE_URL: "postgresql://user:secret@example/postgres" },
  );

  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("secret2"), false);
  assert.equal(output.includes("<redacted-database-url>"), true);
});

run("writes row-count evidence to disk", async () => {
  await withTempRepo(async (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "row-counts.json");
    const evidence = await collectRowCountEvidence({ repoRoot, env: {}, runner: () => ({ command: "supabase db query --linked", status: 1, stdout: "", stderr: "not linked" }) });
    writeRowCountEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.plannedCommand, "npm run db:verify:control-plane -- --row-counts");
  });
});
