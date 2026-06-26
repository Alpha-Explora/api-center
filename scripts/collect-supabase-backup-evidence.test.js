const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectBackupEvidence,
  discoverBackupSchemas,
  writeBackupEvidence,
  sanitize,
} = require("./collect-supabase-backup-evidence.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-backup-evidence-"));
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
  if (joined === "supabase --version") {
    return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
  }
  if (joined === "supabase db dump --help") {
    return {
      command: joined,
      status: 0,
      stdout: "Dumps contents from a remote database.\nFlags: --linked --schema string --file string -f string --dry-run\n",
      stderr: "",
    };
  }
  if (joined.startsWith("supabase db dump --linked")) {
    return { command: joined, status: 0, stdout: "Dumped schema to backup.sql\n", stderr: "" };
  }
  return { command: joined, status: 1, stdout: "", stderr: "unknown command" };
}

run("discovers APICenter and shared-service backup schemas from migrations", () => {
  withTempRepo(
    {
      "supabase/migrations/1.sql": "create schema if not exists api_center; create table api_center_ops.jobs(id uuid);",
      "../api-shared-services/supabase/migrations/1.sql": "CREATE TABLE IF NOT EXISTS \"shared_email\".\"email_messages\" (id uuid); create table shared_sms.sms_messages(id uuid);",
    },
    (repoRoot) => {
      const schemas = discoverBackupSchemas(repoRoot);
      assert.equal(schemas.includes("api_center"), true);
      assert.equal(schemas.includes("api_center_ops"), true);
      assert.equal(schemas.includes("api_center_audit"), true);
      assert.equal(schemas.includes("shared_email"), true);
      assert.equal(schemas.includes("shared_sms"), true);
      assert.equal(schemas.includes("shared_payment"), true);
    },
  );
});

run("marks backup evidence ready when dump is run and backup file exists", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
      "docs/operations/backup.sql": "-- backup\n",
    },
    (repoRoot) => {
      const evidence = collectBackupEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
        runDump: true,
        backupFile: "docs/operations/backup.sql",
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.blockers, []);
      assert.equal(evidence.cli.dumpSupported, true);
      assert.equal(evidence.backupFile.present, true);
      assert.equal(evidence.plannedDumpCommand.includes("--schema"), true);
      assert.equal(JSON.stringify(evidence).includes("sbp_supersecret"), false);
      assert.equal(JSON.stringify(evidence).includes("db-secret"), false);
    },
  );
});

run("marks backup evidence ready when pg_dump is selected", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
    },
    (repoRoot) => {
      const backupRelPath = "supabase/backups/backup.sql";
      const backupAbsPath = path.join(repoRoot, backupRelPath);
      const evidence = collectBackupEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: { DATABASE_URL: "postgresql://api_center_app:secret@example/postgres" },
        runner: (command, args) => {
          const joined = [command, ...args].join(" ");
          if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
          if (joined === "supabase db dump --help") return { command: joined, status: 0, stdout: "Dumps contents from a remote database.\nFlags: --linked --schema string --file string -f string\n", stderr: "" };
          fs.mkdirSync(path.dirname(backupAbsPath), { recursive: true });
          fs.writeFileSync(backupAbsPath, "-- pg dump\n", "utf8");
          return { command: joined, status: 0, stdout: "", stderr: "" };
        },
        runDump: true,
        dumpMethod: "pg_dump",
        pgDumpPath: "pg_dump",
        backupFile: backupRelPath,
      });

      assert.equal(evidence.ready, true);
      assert.equal(evidence.dumpMethod, "pg_dump");
      assert.equal(evidence.backupFile.present, true);
      assert.equal(JSON.stringify(evidence).includes("secret"), false);
      assert.equal(evidence.plannedDumpCommand.includes("<redacted-database-url>"), true);
    },
  );
});

run("blocks backup evidence when dump file is empty after failed dump", () => {
  withTempRepo(
    {
      "supabase/config.toml": "project_id = \"api-center-control-plane\"\n",
      "supabase/.temp/project-ref": "qnebjcboppqdsgmgizvs\n",
      "docs/operations/backup.sql": "",
    },
    (repoRoot) => {
      const evidence = collectBackupEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: (command, args) => {
          const joined = [command, ...args].join(" ");
          if (joined === "supabase --version") return { command: joined, status: 0, stdout: "2.105.0\n", stderr: "" };
          if (joined === "supabase db dump --help") return { command: joined, status: 0, stdout: "Dumps contents from a remote database.\nFlags: --linked --schema string --file string -f string\n", stderr: "" };
          return { command: joined, status: 1, stdout: "", stderr: "docker unavailable" };
        },
        runDump: true,
        backupFile: "docs/operations/backup.sql",
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.backupFile.present, false);
      assert.equal(evidence.backupFile.sizeBytes, 0);
      assert.equal(evidence.blockers.includes("Backup file was created but is empty at docs/operations/backup.sql."), true);
    },
  );
});

run("records blockers when live dump was not run", () => {
  withTempRepo(
    { "supabase/config.toml": "project_id = \"api-center-control-plane\"\n" },
    (repoRoot) => {
      const evidence = collectBackupEvidence({
        repoRoot,
        now: "2026-06-26T00:00:00.000Z",
        env: {},
        runner: fakeRunner,
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.blockers.includes("supabase/.temp/project-ref is not present."), true);
      assert.equal(evidence.blockers.some((blocker) => blocker.includes("Database dump was not run")), true);
    },
  );
});

run("sanitizes secrets from command output", () => {
  const output = sanitize(
    "token sbp_supersecret password=db-secret url postgresql://user:pass@example/postgres",
    {
      SUPABASE_ACCESS_TOKEN: "sbp_supersecret",
      SUPABASE_DB_PASSWORD: "db-secret",
    },
  );

  assert.equal(output.includes("sbp_supersecret"), false);
  assert.equal(output.includes("db-secret"), false);
  assert.equal(output.includes("postgresql://user"), false);
});

run("writes backup evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const outPath = path.join(repoRoot, "docs", "operations", "backup-evidence.json");
    const evidence = collectBackupEvidence({ repoRoot, env: {}, runner: fakeRunner });
    writeBackupEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.cli.dumpSupported, true);
  });
});
