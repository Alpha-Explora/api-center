#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OBSERVED_LIVE_ENV = ["DATABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "PG_DUMP_PATH"];
const FALLBACK_SCHEMAS = [
  "api_center",
  "api_center_ops",
  "api_center_audit",
  "shared_payment",
  "shared_otp",
  "shared_email",
  "shared_sms",
  "shared_geo",
  "shared_gauth",
];
const MAX_OUTPUT_LENGTH = 4000;

function collectBackupEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  runDump = false,
  backupFile = "docs/operations/supabase-live-backup-2026-06-26.sql",
  dumpMethod = "supabase",
  pgDumpPath = env.PG_DUMP_PATH || findPgDump(),
} = {}) {
  const supabase = collectSupabaseLink(repoRoot);
  const environment = Object.fromEntries(
    OBSERVED_LIVE_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const schemas = discoverBackupSchemas(repoRoot);
  const schemaArg = schemas.join(",");
  const version = runner("supabase", ["--version"], { cwd: repoRoot, env });
  const dumpHelp = runner("supabase", ["db", "dump", "--help"], { cwd: repoRoot, env });
  const dumpSupported = dumpHelp.status === 0 && /db dump|Dumps/i.test(dumpHelp.stdout + dumpHelp.stderr);
  const supportsLinked = /--linked/.test(dumpHelp.stdout + dumpHelp.stderr);
  const supportsSchema = /--schema/.test(dumpHelp.stdout + dumpHelp.stderr);
  const supportsFile = /--file|-f/.test(dumpHelp.stdout + dumpHelp.stderr);

  const blockers = [];
  if (version.status !== 0) blockers.push("Supabase CLI version check failed.");
  if (dumpMethod !== "pg_dump") {
    if (!dumpSupported) blockers.push("Supabase CLI db dump command is unavailable or failed help discovery.");
    if (!supportsLinked) blockers.push("Supabase CLI db dump help does not advertise --linked.");
    if (!supportsSchema) blockers.push("Supabase CLI db dump help does not advertise --schema.");
    if (!supportsFile) blockers.push("Supabase CLI db dump help does not advertise --file/-f.");
  }
  if (!supabase.projectRef) blockers.push("supabase/.temp/project-ref is not present.");

  const plannedDumpCommand =
    dumpMethod === "pg_dump"
      ? [
          pgDumpPath || "pg_dump",
          "--dbname",
          "<redacted-database-url>",
          "--file",
          backupFile,
          "--format",
          "plain",
          "--no-owner",
          "--no-privileges",
          ...schemas.flatMap((schema) => ["--schema", schema]),
        ]
      : ["supabase", "db", "dump", "--linked", "--schema", schemaArg, "--file", backupFile];
  let dumpRun;
  if (runDump) {
    if (dumpMethod === "pg_dump") {
      if (!env.DATABASE_URL) blockers.push("DATABASE_URL is required for pg_dump backup evidence.");
      if (!pgDumpPath) blockers.push("pg_dump executable was not found; set PG_DUMP_PATH or use Supabase CLI dump.");
      if (env.DATABASE_URL && pgDumpPath) {
        const args = [
          "--dbname=" + env.DATABASE_URL,
          "--file=" + path.resolve(repoRoot, backupFile),
          "--format=plain",
          "--no-owner",
          "--no-privileges",
          ...schemas.map((schema) => "--schema=" + schema),
        ];
        dumpRun = runner(pgDumpPath, args, { cwd: repoRoot, env });
      }
    } else {
      dumpRun = runner(plannedDumpCommand[0], plannedDumpCommand.slice(1), { cwd: repoRoot, env });
    }
    if (dumpRun && dumpRun.status !== 0) blockers.push("Database dump did not complete successfully.");
  } else {
    blockers.push("Database dump was not run; pass --run-dump in a live operator shell after backup prerequisites are present.");
  }

  const backupStatus = backupFileStatus(path.resolve(repoRoot, backupFile));
  const backupExists = backupStatus.present && backupStatus.sizeBytes > 0;
  if (runDump && !backupStatus.present) blockers.push("Backup file was not created at " + backupFile + ".");
  if (runDump && backupStatus.present && backupStatus.sizeBytes === 0) blockers.push("Backup file was created but is empty at " + backupFile + ".");

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    environment,
    schemas,
    dumpMethod,
    pgDumpPath: pgDumpPath ? "<present>" : undefined,
    plannedDumpCommand: plannedDumpCommand.join(" "),
    cli: {
      version: serializeCommand(version, env),
      dumpHelp: serializeCommand(dumpHelp, env),
      dumpSupported,
      supportsLinked,
      supportsSchema,
      supportsFile,
    },
    dumpRun: dumpRun ? serializeCommand(dumpRun, env) : undefined,
    backupFile: {
      path: backupFile,
      present: backupExists,
      sizeBytes: backupStatus.sizeBytes,
    },
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "npm run db:backup:evidence -- --run-dump --backup-file docs/operations/supabase-live-backup-<date>.sql --out docs/operations/supabase-backup-readiness-<date>.json",
      plannedDumpCommand.join(" "),
      "Store the dump in the approved operations evidence location and verify restore against a disposable database before applying DDL.",
    ],
  };
}

function findPgDump() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe",
          "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
          "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
          "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
          "C:\\Program Files\\PostgreSQL\\18\\pgAdmin 4\\runtime\\pg_dump.exe",
        ]
      : ["/usr/bin/pg_dump", "/usr/local/bin/pg_dump", "/opt/homebrew/bin/pg_dump"];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function backupFileStatus(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { present: stat.isFile(), sizeBytes: stat.isFile() ? stat.size : 0 };
  } catch (error) {
    if (error && error.code === "ENOENT") return { present: false, sizeBytes: 0 };
    throw error;
  }
}

function discoverBackupSchemas(repoRoot) {
  const migrationDirs = [
    path.join(repoRoot, "supabase", "migrations"),
    path.resolve(repoRoot, "..", "api-shared-services", "supabase", "migrations"),
  ];
  const schemas = new Set(FALLBACK_SCHEMAS);
  for (const dir of migrationDirs) {
    for (const filePath of listSqlFiles(dir)) {
      const content = fs.readFileSync(filePath, "utf8");
      for (const match of content.matchAll(/(?:create\s+schema\s+(?:if\s+not\s+exists\s+)?|(?:from|into|update|join|table|references|alter\s+table|create\s+table(?:\s+if\s+not\s+exists)?|create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+\S+\s+on)\s+)["']?((?:api_center(?:_ops|_audit)?)|(?:shared_[a-z_]+))["']?\./gi)) {
        schemas.add(match[1].toLowerCase());
      }
      for (const match of content.matchAll(/create\s+schema\s+(?:if\s+not\s+exists\s+)?["']?((?:api_center(?:_ops|_audit)?)|(?:shared_[a-z_]+))["']?/gi)) {
        schemas.add(match[1].toLowerCase());
      }
    }
  }
  return [...schemas].sort(schemaSort);
}

function schemaSort(a, b) {
  const order = ["api_center", "api_center_ops", "api_center_audit"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : 99) - (bi >= 0 ? bi : 99);
  return a.localeCompare(b);
}

function listSqlFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 180000,
    windowsHide: true,
  });
  return {
    command: [command, ...args].join(" "),
    status: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || undefined,
    error: result.error ? result.error.message : undefined,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function serializeCommand(result, env) {
  return {
    command: sanitize(result.command || "", env),
    status: result.status,
    signal: result.signal,
    error: sanitize(result.error || "", env) || undefined,
    stdout: truncate(sanitize(result.stdout || "", env)),
    stderr: truncate(sanitize(result.stderr || "", env)),
  };
}

function sanitize(value, env) {
  let text = String(value || "");
  for (const key of ["DATABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]) {
    const secret = env[key];
    if (typeof secret === "string" && secret.length > 0) {
      text = text.split(secret).join("<redacted-" + key.toLowerCase().replace(/_/g, "-") + ">");
    }
  }
  text = text.replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>");
  text = text.replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>");
  text = text.replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>");
  return text;
}

function truncate(value) {
  if (value.length <= MAX_OUTPUT_LENGTH) return value;
  return value.slice(0, MAX_OUTPUT_LENGTH) + "\n<truncated>";
}

function collectSupabaseLink(repoRoot) {
  return {
    configProjectId: readConfigProjectId(path.join(repoRoot, "supabase", "config.toml")),
    projectRef: readTrimmed(path.join(repoRoot, "supabase", ".temp", "project-ref")),
  };
}

function readConfigProjectId(filePath) {
  const content = readOptional(filePath);
  if (!content) return undefined;
  const match = content.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m);
  return match?.[1];
}

function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function readTrimmed(filePath) {
  const content = readOptional(filePath);
  return content?.trim() || undefined;
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function writeBackupEvidence(evidence, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function main() {
  const evidence = collectBackupEvidence({
    runDump: process.argv.includes("--run-dump"),
    backupFile: readArg("--backup-file") || "docs/operations/supabase-live-backup-2026-06-26.sql",
    dumpMethod: readArg("--dump-method") || "supabase",
  });
  const outPath = readArg("--out");
  if (outPath) writeBackupEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectBackupEvidence,
  discoverBackupSchemas,
  writeBackupEvidence,
  sanitize,
};

if (require.main === module) {
  main();
}
