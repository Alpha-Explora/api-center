#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const OBSERVED_LIVE_ENV = ["DATABASE_URL"];
const MAX_OUTPUT_LENGTH = 8000;

async function collectRowCountEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  runRowCounts = true,
  clientFactory = (connectionString) => new Client({ connectionString }),
} = {}) {
  const environment = Object.fromEntries(
    OBSERVED_LIVE_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const command = npmCommand();
  const args = ["run", "db:verify:control-plane", "--", "--row-counts"];
  const linkedQueryArgs = ["db", "query", "--linked", "-o", "json", rowCountSql()];
  const plannedCommand = ["npm", ...args].join(" ");
  const plannedLinkedCommand = ["supabase", ...linkedQueryArgs].join(" ");
  const blockers = [];

  let rowCountRun;
  let linkedQueryRun;
  let linkedRows = [];
  if (runRowCounts) {
    if (environment.DATABASE_URL.present) {
      rowCountRun = await queryDirectRowCounts(env.DATABASE_URL, clientFactory);
      if (rowCountRun.status !== 0) blockers.push("Direct row-count query did not complete successfully.");
      else linkedRows = parseLinkedQueryRows(rowCountRun.stdout);
    } else {
      linkedQueryRun = runner("supabase", linkedQueryArgs, { cwd: repoRoot, env });
      if (linkedQueryRun.status !== 0) {
        blockers.push("DATABASE_URL is not set and supabase db query --linked row-count inventory did not complete successfully.");
      } else {
        linkedRows = parseLinkedQueryRows(linkedQueryRun.stdout);
      }
    }
  } else {
    blockers.push("Row-count verifier was not run; remove --skip-run in a live operator shell after DATABASE_URL or Supabase linked CLI access is present.");
  }

  return {
    generatedAt: now,
    repoRoot,
    environment,
    plannedCommand,
    plannedLinkedCommand,
    rowCountRun: rowCountRun ? serializeCommand(rowCountRun, env) : undefined,
    linkedQueryRun: linkedQueryRun ? serializeCommand(linkedQueryRun, env) : undefined,
    linkedRows,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Set DATABASE_URL in the live operator shell without committing it, or use authenticated supabase db query --linked for inventory evidence.",
      "npm run db:row-counts:evidence -- --out docs/operations/supabase-row-counts-<date>.json",
      plannedCommand,
      plannedLinkedCommand,
      "Attach the generated artifact to the migration approval packet before DDL is applied.",
    ],
  };
}

async function queryDirectRowCounts(databaseUrl, clientFactory) {
  const client = clientFactory(databaseUrl);
  try {
    await client.connect();
    const result = await client.query(rowCountSql());
    return {
      command: "direct postgres row-count query",
      status: 0,
      stdout: JSON.stringify({ rows: result.rows }),
      stderr: "",
    };
  } catch (error) {
    return {
      command: "direct postgres row-count query",
      status: 1,
      error: error && error.message ? error.message : String(error),
      stdout: "",
      stderr: "",
    };
  } finally {
    if (typeof client.end === "function") await client.end().catch(() => undefined);
  }
}

function rowCountSql() {
  const schemas = ["api_center", "api_center_ops", "api_center_audit", "apic_catalog", "apic_governance", "apic_runtime", "apic_audit"];
  const schemaList = schemas.map((schema) => "'" + schema + "'").join(", ");
  return "select table_schema, table_name, (xpath('/row/count/text()', query_to_xml(format('select count(*) as count from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as row_count from information_schema.tables where table_schema in (" + schemaList + ") and table_type = 'BASE TABLE' order by table_schema, table_name";
}

function parseLinkedQueryRows(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60000,
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
    command: result.command.replace(/^npm\.cmd\b/i, "npm"),
    status: result.status,
    signal: result.signal,
    error: sanitize(result.error || "", env) || undefined,
    stdout: truncate(sanitize(result.stdout || "", env)),
    stderr: truncate(sanitize(result.stderr || "", env)),
  };
}

function sanitize(value, env) {
  let text = String(value || "");
  for (const key of OBSERVED_LIVE_ENV) {
    const secret = env[key];
    if (typeof secret === "string" && secret.length > 0) {
      text = text.split(secret).join("<redacted-" + key.toLowerCase().replace(/_/g, "-") + ">");
    }
  }
  text = text.replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>");
  text = text.replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>");
  return text;
}

function truncate(value) {
  if (value.length <= MAX_OUTPUT_LENGTH) return value;
  return value.slice(0, MAX_OUTPUT_LENGTH) + "\n<truncated>";
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function writeRowCountEvidence(evidence, outPath) {
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
  const evidence = await collectRowCountEvidence({
    runRowCounts: !process.argv.includes("--skip-run"),
  });
  const outPath = readArg("--out");
  if (outPath) writeRowCountEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectRowCountEvidence,
  writeRowCountEvidence,
  sanitize,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
