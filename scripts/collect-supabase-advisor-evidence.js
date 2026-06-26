#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OBSERVED_LIVE_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const MAX_OUTPUT_LENGTH = 4000;

function collectAdvisorEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  runAdvisors = false,
} = {}) {
  const supabase = collectSupabaseLink(repoRoot);
  const environment = Object.fromEntries(
    OBSERVED_LIVE_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const version = runner("supabase", ["--version"], { cwd: repoRoot, env });
  const advisorsHelp = runner("supabase", ["db", "advisors", "--help"], {
    cwd: repoRoot,
    env,
  });
  const advisorsSupported =
    advisorsHelp.status === 0 && /advisors/i.test(advisorsHelp.stdout + advisorsHelp.stderr);

  const blockers = [];
  if (version.status !== 0) blockers.push("Supabase CLI version check failed.");
  if (!advisorsSupported) blockers.push("Supabase CLI advisors command is unavailable or failed help discovery.");
  if (!supabase.projectRef) blockers.push("supabase/.temp/project-ref is not present.");

  let advisorRun;
  if (runAdvisors) {
    advisorRun = runner("supabase", ["db", "advisors", "--linked"], { cwd: repoRoot, env });
    if (advisorRun.status !== 0) blockers.push("supabase db advisors did not complete successfully.");
  } else {
    blockers.push("supabase db advisors was not run; pass --run-advisors in a live operator shell after Supabase CLI auth and linked pooler metadata are present.");
  }

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    environment,
    cli: {
      version: serializeCommand(version, env),
      advisorsHelp: serializeCommand(advisorsHelp, env),
      advisorsSupported,
    },
    advisorRun: advisorRun ? serializeCommand(advisorRun, env) : undefined,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "npm run db:advisors:evidence -- --run-advisors --out docs/operations/supabase-advisors-<date>.json",
      "supabase db advisors --linked",
      "Review performance and security advisor findings before live migration approval.",
    ],
  };
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

function writeAdvisorEvidence(evidence, outPath) {
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
  const evidence = collectAdvisorEvidence({ runAdvisors: process.argv.includes("--run-advisors") });
  const outPath = readArg("--out");
  if (outPath) writeAdvisorEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectAdvisorEvidence,
  writeAdvisorEvidence,
  sanitize,
};

if (require.main === module) {
  main();
}
