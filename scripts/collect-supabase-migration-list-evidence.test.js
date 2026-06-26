const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectMigrationListEvidence,
  parseMigrationList,
  writeMigrationListEvidence,
  sanitize,
} = require("./collect-supabase-migration-list-evidence.js");

async function run(name, fn) {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

async function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-migration-list-evidence-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function fakeRunner(command, args) {
  const joined = [command, ...args].join(" ");
  if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
  if (joined === "supabase migration list --help") return { command: joined, status: 0, stdout: "List local and remote migrations. Flags: --linked --local\n", stderr: "" };
  if (joined === "supabase migration list --linked") return { command: joined, status: 0, stdout: "  Local          | Remote         | Time\n  20260625010101 | 20260625010101 | init\n", stderr: "" };
  if (joined === "supabase migration list --local") return { command: joined, status: 0, stdout: "  Local          | Remote\n  20260625010101 |                | init\n", stderr: "" };
  return { command: joined, status: 1, stdout: "", stderr: "unknown" };
}

run("parses migration list table rows", () => {
  const rows = parseMigrationList("Local | Remote | Time\n20260625010101 | 20260625010101 | init\n");
  assert.deepEqual(rows, [{ local: "20260625010101", remote: "20260625010101", name: "init" }]);
  const localOnly = parseMigrationList("Local | Remote | Time\n20260625162216 |                | 2026-06-25 16:22:16\n");
  assert.deepEqual(localOnly, [{ local: "20260625162216", remote: undefined, name: "2026-06-25 16:22:16" }]);
});

run("records blockers when linked list is not run", async () => {
  await withTempRepo({ "supabase/config.toml": "project_id = \"api-center-control-plane\"\n" }, async (repoRoot) => {
    const evidence = await collectMigrationListEvidence({ repoRoot, env: {}, now: "2026-06-26T00:00:00.000Z", runner: fakeRunner });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.cli.listSupported, true);
    assert.equal(evidence.blockers.includes("supabase/.temp/project-ref is not present."), true);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("--linked was not run")), true);
  });
});

run("marks ready when linked migration list succeeds with CLI auth", async () => {
  await withTempRepo({
    "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
    "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
  }, async (repoRoot) => {
    const evidence = await collectMigrationListEvidence({
      repoRoot,
      env: {},
      now: "2026-06-26T00:00:00.000Z",
      runner: fakeRunner,
      runLinked: true,
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.parsed.linkedRows.length, 1);
    assert.equal(JSON.stringify(evidence).includes("sbp_supersecret"), false);
    assert.equal(JSON.stringify(evidence).includes("db-secret"), false);
  });
});

run("records linked migration list failure", async () => {
  const evidence = await collectMigrationListEvidence({
    repoRoot: "C:/repo",
    env: {},
    runner: (command, args) => {
      const joined = [command, ...args].join(" ");
      if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0", stderr: "" };
      if (joined === "supabase migration list --help") return { command: joined, status: 0, stdout: "Flags: --linked --local", stderr: "" };
      return { command: joined, status: 1, stdout: "", stderr: "password=db-secret token sbp_supersecret" };
    },
    runLinked: true,
  });
  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("supabase/.temp/project-ref is not present."), true);
  assert.equal(evidence.blockers.includes("supabase migration list --linked did not complete successfully."), true);
  assert.equal(evidence.linkedRun.stderr.includes("db-secret"), false);
});

run("falls back to direct migration-history query when linked CLI auth fails", async () => {
  await withTempRepo({
    "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
    "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
  }, async (repoRoot) => {
    const evidence = await collectMigrationListEvidence({
      repoRoot,
      env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
      now: "2026-06-26T00:00:00.000Z",
      runner: (command, args) => {
        const joined = [command, ...args].join(" ");
        if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0", stderr: "" };
        if (joined === "supabase migration list --help") return { command: joined, status: 0, stdout: "List local and remote migrations. Flags: --linked --local", stderr: "" };
        return { command: joined, status: 1, stdout: "", stderr: "password failed" };
      },
      runLinked: true,
      clientFactory: () => ({
        connect: async () => undefined,
        query: async () => ({ rows: [{ version: "20260515000000", name: "init", inserted_at: "2026-05-15T00:00:00.000Z" }] }),
        end: async () => undefined,
      }),
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.directMigrationRun.status, 0);
    assert.equal(evidence.parsed.linkedRows[0].remote, "20260515000000");
    assert.equal(JSON.stringify(evidence).includes("postgresql://user"), false);
  });
});

run("falls back to direct migration-history query when inserted_at is unavailable", async () => {
  await withTempRepo({
    "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
    "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
  }, async (repoRoot) => {
    const evidence = await collectMigrationListEvidence({
      repoRoot,
      env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
      now: "2026-06-26T00:00:00.000Z",
      runner: (command, args) => {
        const joined = [command, ...args].join(" ");
        if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0", stderr: "" };
        if (joined === "supabase migration list --help") return { command: joined, status: 0, stdout: "List local and remote migrations. Flags: --linked --local", stderr: "" };
        return { command: joined, status: 1, stdout: "", stderr: "password failed" };
      },
      runLinked: true,
      clientFactory: () => ({
        connect: async () => undefined,
        query: async (sql) => {
          if (String(sql).includes("inserted_at")) throw new Error("column \"inserted_at\" does not exist");
          return { rows: [{ version: "20260515000000", name: "init", statements: [] }] };
        },
        end: async () => undefined,
      }),
    });
    assert.equal(evidence.ready, true);
    assert.equal(evidence.directMigrationRun.status, 0);
    assert.equal(evidence.parsed.linkedRows[0].remote, "20260515000000");
  });
});

run("omits migration statements from direct migration-history evidence", async () => {
  await withTempRepo({
    "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
    "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
  }, async (repoRoot) => {
    const evidence = await collectMigrationListEvidence({
      repoRoot,
      env: { DATABASE_URL: "postgresql://user:secret@example/postgres" },
      runner: (command, args) => {
        const joined = [command, ...args].join(" ");
        if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0", stderr: "" };
        if (joined === "supabase migration list --help") return { command: joined, status: 0, stdout: "List local and remote migrations. Flags: --linked --local", stderr: "" };
        return { command: joined, status: 1, stdout: "", stderr: "" };
      },
      runLinked: true,
      clientFactory: () => ({
        connect: async () => undefined,
        query: async () => ({ rows: [{ version: "20260515000000", name: "init", statements: ["create table private.full_ddl(id uuid)"], inserted_at: "2026-05-15T00:00:00.000Z" }] }),
        end: async () => undefined,
      }),
    });
    assert.equal(evidence.ready, true);
    assert.equal(JSON.stringify(evidence).includes("private.full_ddl"), false);
  });
});

run("writes migration list evidence to disk", async () => {
  await withTempRepo({}, async (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "migration-list.json");
    const evidence = await collectMigrationListEvidence({ repoRoot, env: {}, runner: fakeRunner });
    writeMigrationListEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.cli.listSupported, true);
  });
});

run("sanitizes tokens, urls, and password assignments", () => {
  const output = sanitize("url postgresql://user:pass@example/postgres token sbp_supersecret password=db-secret", {
    SUPABASE_ACCESS_TOKEN: "sbp_supersecret",
    SUPABASE_DB_PASSWORD: "db-secret",
  });
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("sbp_supersecret"), false);
  assert.equal(output.includes("db-secret"), false);
});
