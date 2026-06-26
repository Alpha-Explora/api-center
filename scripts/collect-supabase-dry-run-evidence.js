#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OBSERVED_LIVE_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const MAX_OUTPUT_LENGTH = 4000;

function collectDryRunEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  runDryRun = false,
  backupEvidencePath = "docs/operations/supabase-backup-readiness-2026-06-26.json",
} = {}) {
  const supabase = collectSupabaseLink(repoRoot);
  const environment = Object.fromEntries(
    OBSERVED_LIVE_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const backupEvidence = readBackupEvidence(path.resolve(repoRoot, backupEvidencePath));
  const version = runner("supabase", ["--version"], { cwd: repoRoot, env });
  const pushHelp = runner("supabase", ["db", "push", "--help"], { cwd: repoRoot, env });
  const pushSupported = pushHelp.status === 0 && /db push|Push/i.test(pushHelp.stdout + pushHelp.stderr);
  const supportsDryRun = /--dry-run/.test(pushHelp.stdout + pushHelp.stderr);
  const supportsLinked = /--linked/.test(pushHelp.stdout + pushHelp.stderr);

  const blockers = [];
  if (version.status !== 0) blockers.push("Supabase CLI version check failed.");
  if (!pushSupported) blockers.push("Supabase CLI db push command is unavailable or failed help discovery.");
  if (!supportsDryRun) blockers.push("Supabase CLI db push help does not advertise --dry-run.");
  if (!supportsLinked) blockers.push("Supabase CLI db push help does not advertise --linked.");
  if (!supabase.projectRef) blockers.push("supabase/.temp/project-ref is not present.");
  if (!backupEvidence.present) {
    blockers.push("Backup evidence file is missing: " + backupEvidencePath + ".");
  } else if (!backupEvidence.backupFilePresent) {
    blockers.push("Backup evidence does not prove a live dump file exists.");
  }

  const plannedDryRunCommand = ["supabase", "db", "push", "--dry-run", "--linked"];
  let dryRun;
  if (runDryRun) {
    dryRun = runner(plannedDryRunCommand[0], plannedDryRunCommand.slice(1), { cwd: repoRoot, env });
    if (dryRun.status !== 0) blockers.push("supabase db push --dry-run did not complete successfully.");
  } else {
    blockers.push("supabase db push --dry-run was not run; pass --run-dry-run in a live operator shell after dump/restore prerequisites are met.");
  }

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    environment,
    backupEvidence,
    plannedDryRunCommand: plannedDryRunCommand.join(" "),
    cli: {
      version: serializeCommand(version, env),
      pushHelp: serializeCommand(pushHelp, env),
      pushSupported,
      supportsDryRun,
      supportsLinked,
    },
    dryRun: dryRun ? serializeCommand(dryRun, env) : undefined,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Create or restore the live dump into a disposable database before dry-run approval.",
      "npm run db:dry-run:evidence -- --run-dry-run --out docs/operations/supabase-dry-run-readiness-<date>.json",
      plannedDryRunCommand.join(" "),
      "Run npm run db:verify:control-plane against the restored database after the dry-run plan is reviewed.",
    ],
  };
}

function readBackupEvidence(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      present: true,
      path: path.relative(path.resolve(__dirname, ".."), filePath).replace(/\\/g, "/"),
      ready: Boolean(parsed.ready),
      backupFilePath: parsed.backupFile?.path,
      backupFilePresent: Boolean(parsed.backupFile?.present),
      schemas: Array.isArray(parsed.schemas) ? parsed.schemas : [],
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { present: false, path: filePath };
    }
    throw error;
  }
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 15000,
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

function writeDryRunEvidence(evidence, outPath) {
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
  const evidence = collectDryRunEvidence({
    runDryRun: process.argv.includes("--run-dry-run"),
    backupEvidencePath: readArg("--backup-evidence") || "docs/operations/supabase-backup-readiness-2026-06-26.json",
  });
  const outPath = readArg("--out");
  if (outPath) writeDryRunEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectDryRunEvidence,
  writeDryRunEvidence,
  sanitize,
};

if (require.main === module) {
  main();
}
