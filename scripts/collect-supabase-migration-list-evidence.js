#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const OBSERVED_LIVE_ENV = ["DATABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const MAX_OUTPUT_LENGTH = 8000;

async function collectMigrationListEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  runLinked = false,
  runLocal = false,
  clientFactory = (connectionString) => new Client({ connectionString }),
} = {}) {
  const supabase = collectSupabaseLink(repoRoot);
  const environment = Object.fromEntries(
    OBSERVED_LIVE_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const version = runner("supabase", ["--version"], { cwd: repoRoot, env });
  const migrationHelp = runner("supabase", ["migration", "list", "--help"], { cwd: repoRoot, env });
  const helpText = migrationHelp.stdout + migrationHelp.stderr;
  const listSupported = migrationHelp.status === 0 && /migration list|List/i.test(helpText);
  const supportsLinked = /--linked/.test(helpText);
  const supportsLocal = /--local/.test(helpText);

  const blockers = [];
  if (version.status !== 0) blockers.push("Supabase CLI version check failed.");
  if (!listSupported) blockers.push("Supabase CLI migration list command is unavailable or failed help discovery.");
  if (!supportsLinked) blockers.push("Supabase CLI migration list help does not advertise --linked.");
  if (!supportsLocal) blockers.push("Supabase CLI migration list help does not advertise --local.");
  if (!supabase.projectRef) blockers.push("supabase/.temp/project-ref is not present.");

  let linkedRun;
  let directMigrationRun;
  let directMigrationRows = [];
  if (runLinked) {
    linkedRun = runner("supabase", ["migration", "list", "--linked"], { cwd: repoRoot, env });
    if (linkedRun.status !== 0 && environment.DATABASE_URL.present) {
      directMigrationRun = await queryDirectMigrations(env.DATABASE_URL, clientFactory);
      if (directMigrationRun.status === 0) {
        directMigrationRows = parseDirectMigrationRows(directMigrationRun.stdout);
      } else {
        blockers.push("supabase migration list --linked and direct migration-history query did not complete successfully.");
      }
    } else if (linkedRun.status !== 0) {
      blockers.push("supabase migration list --linked did not complete successfully.");
    }
  } else if (environment.DATABASE_URL.present) {
    directMigrationRun = await queryDirectMigrations(env.DATABASE_URL, clientFactory);
    if (directMigrationRun.status === 0) {
      directMigrationRows = parseDirectMigrationRows(directMigrationRun.stdout);
    } else {
      blockers.push("Direct migration-history query did not complete successfully.");
    }
  } else {
    blockers.push("supabase migration list --linked was not run; pass --run-linked in a live operator shell after Supabase CLI auth and linked pooler metadata are present.");
  }

  let localRun;
  if (runLocal) {
    localRun = runner("supabase", ["migration", "list", "--local"], { cwd: repoRoot, env });
    if (localRun.status !== 0) blockers.push("supabase migration list --local did not complete successfully.");
  }

  const linkedRows = directMigrationRows.length > 0 ? directMigrationRows : linkedRun && linkedRun.status === 0 ? parseMigrationList(linkedRun.stdout + "\n" + linkedRun.stderr) : [];
  const localRows = localRun && localRun.status === 0 ? parseMigrationList(localRun.stdout + "\n" + localRun.stderr) : [];

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    environment,
    cli: {
      version: serializeCommand(version, env),
      migrationListHelp: serializeCommand(migrationHelp, env),
      listSupported,
      supportsLinked,
      supportsLocal,
    },
    linkedRun: linkedRun ? serializeCommand(linkedRun, env) : undefined,
    directMigrationRun: directMigrationRun ? serializeCommand(directMigrationRun, env) : undefined,
    localRun: localRun ? serializeCommand(localRun, env) : undefined,
    parsed: {
      linkedRows,
      localRows,
    },
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "npm run db:migration-list:evidence -- --run-linked --out docs/operations/supabase-migration-list-<date>.json",
      "supabase migration list --linked",
      "Compare linked migration history with the repository migration files before applying DDL.",
    ],
  };
}

async function queryDirectMigrations(databaseUrl, clientFactory) {
  const client = clientFactory(databaseUrl);
  try {
    await client.connect();
    const result = await querySchemaMigrations(client);
    const rows = result.rows.map(({ version, name, inserted_at }) => ({ version, name, inserted_at }));
    return {
      command: "direct postgres migration-history query",
      status: 0,
      stdout: JSON.stringify({ rows }),
      stderr: "",
    };
  } catch (error) {
    return {
      command: "direct postgres migration-history query",
      status: 1,
      error: error && error.message ? error.message : String(error),
      stdout: "",
      stderr: "",
    };
  } finally {
    if (typeof client.end === "function") await client.end().catch(() => undefined);
  }
}

async function querySchemaMigrations(client) {
  try {
    return await client.query("select version, name, inserted_at from supabase_migrations.schema_migrations order by version");
  } catch (error) {
    if (!isMissingColumnError(error, "inserted_at")) throw error;
    return await client.query("select version, name from supabase_migrations.schema_migrations order by version");
  }
}

function isMissingColumnError(error, columnName) {
  const message = error && error.message ? String(error.message) : String(error || "");
  return message.toLowerCase().includes("column") && message.includes(columnName) && message.toLowerCase().includes("does not exist");
}

function parseDirectMigrationRows(stdout) {
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  return rows.map((row) => ({
    local: undefined,
    remote: String(row.version || ""),
    name: row.name ? String(row.name) : undefined,
    insertedAt: row.inserted_at ? String(row.inserted_at) : undefined,
  })).filter((row) => row.remote);
}

function parseMigrationList(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[-+|\s]+$/.test(trimmed) || /local\s+\|\s+remote/i.test(trimmed)) continue;
    if (!trimmed.includes("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length >= 2 && /^\d{8,}/.test((cells[0] || "") + (cells[1] || ""))) {
      rows.push({ local: cells[0] || undefined, remote: cells[1] || undefined, name: cells[2] || undefined });
    }
  }
  return rows;
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 20000,
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
    command: result.command,
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

function writeMigrationListEvidence(evidence, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

async function main() {
  const evidence = await collectMigrationListEvidence({
    runLinked: process.argv.includes("--run-linked"),
    runLocal: process.argv.includes("--run-local"),
  });
  const outPath = readArg("--out");
  if (outPath) writeMigrationListEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectMigrationListEvidence,
  parseMigrationList,
  writeMigrationListEvidence,
  sanitize,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
