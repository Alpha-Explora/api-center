#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runStaticEnterpriseMigrationChecks } = require("./check-enterprise-migration-static.js");

const MAX_OUTPUT_LENGTH = 8000;
const DEFAULT_ROLE_DISCOVERY_PATH = "docs/operations/supabase-role-discovery-2026-06-26.json";

function collectVerifierEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  runner = runCommand,
  staticChecker = runStaticEnterpriseMigrationChecks,
  roleDiscoveryPath = DEFAULT_ROLE_DISCOVERY_PATH,
  appRole,
  runLive = true,
  postCompatibilityCleanup = false,
} = {}) {
  const discoveredRole = appRole || readDiscoveredRole(path.resolve(repoRoot, roleDiscoveryPath));
  const environment = { DATABASE_URL: redactedEnvStatus(env, "DATABASE_URL") };
  const blockers = [];
  const staticRun = runStaticCheck(staticChecker, repoRoot, env);
  if (staticRun.status !== 0) blockers.push("Static enterprise migration verifier failed.");

  const liveModes = [
    { id: "base", args: [] },
    postCompatibilityCleanup
      ? { id: "legacy_schemas_absent", args: ["--forbid-legacy-schemas"] }
      : { id: "compat_views", args: ["--require-compat-views"] },
    { id: "retention_policy", args: ["--require-retention-policy"] },
  ];
  const liveRuns = [];

  if (!environment.DATABASE_URL.present) blockers.push("DATABASE_URL is not set.");
  if (!discoveredRole) blockers.push("No app role was supplied or discovered.");

  if (environment.DATABASE_URL.present && discoveredRole && runLive) {
    for (const mode of liveModes) {
      const args = [
        path.join(repoRoot, "node_modules", "ts-node", "dist", "bin.js"),
        path.join(repoRoot, "scripts", "verify-control-plane-schema.ts"),
        "--app-role",
        discoveredRole,
        ...mode.args,
      ];
      const result = runner(process.execPath, args, { cwd: repoRoot, env });
      liveRuns.push({ id: mode.id, command: ["node", ...args].join(" "), result: serializeCommand(result, env) });
      if (result.status !== 0) blockers.push("Live verifier mode failed: " + mode.id + ".");
    }
  } else if (environment.DATABASE_URL.present && discoveredRole && !runLive) {
    blockers.push("Live verifier modes were not run; remove --skip-live in a live operator shell.");
  }

  return {
    generatedAt: now,
    repoRoot,
    environment,
    appRole: discoveredRole || undefined,
    roleDiscoveryPath,
    staticRun: serializeCommand(staticRun, env),
    requiredLiveModes: liveModes.map((mode) => ({
      id: mode.id,
      command: ["npm", "run", "db:verify:control-plane", "--", "--app-role", discoveredRole || "<discovered-app-role>", ...mode.args].join(" "),
    })),
    liveRuns,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Run npm run db:discover:roles -- --out docs/operations/supabase-role-discovery-<date>.json against the live DATABASE_URL.",
      "Run npm run db:verifier:evidence -- --out docs/operations/supabase-verifier-readiness-<date>.json after DATABASE_URL and app role are available.",
      "Confirm the artifact shows all required live verifier modes passed before approving the migration.",
    ],
  };
}


function runStaticCheck(staticChecker, repoRoot, env) {
  try {
    const failures = staticChecker({ repoRoot });
    if (Array.isArray(failures) && failures.length > 0) {
      return {
        command: "npm run db:verify:enterprise-static",
        status: 1,
        stdout: "",
        stderr: "Static enterprise migration verification failed:\n" + failures.map((failure) => "- " + failure).join("\n"),
      };
    }
    return {
      command: "npm run db:verify:enterprise-static",
      status: 0,
      stdout: "Static enterprise migration verification passed.",
      stderr: "",
    };
  } catch (error) {
    return {
      command: "npm run db:verify:enterprise-static",
      status: 1,
      error: error instanceof Error ? error.message : String(error),
      stdout: "",
      stderr: "",
    };
  }
}

function readDiscoveredRole(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed.recommendedAppRoles) && parsed.recommendedAppRoles.length > 0) return parsed.recommendedAppRoles[0];
    if (typeof parsed.appRole === "string" && parsed.appRole.length > 0) return parsed.appRole;
    return undefined;
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 90000,
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
    command: String(result.command || "").replace(/^npm\.cmd\b/i, "npm"),
    status: typeof result.status === "number" ? result.status : 1,
    signal: result.signal,
    error: sanitize(result.error || "", env) || undefined,
    stdout: truncate(sanitize(result.stdout || "", env)),
    stderr: truncate(sanitize(result.stderr || "", env)),
  };
}

function sanitize(value, env) {
  let text = String(value || "");
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl === "string" && databaseUrl.length > 0) {
    text = text.split(databaseUrl).join("<redacted-database-url>");
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

function writeVerifierEvidence(evidence, outPath) {
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
  const evidence = collectVerifierEvidence({
    appRole: readArg("--app-role"),
    roleDiscoveryPath: readArg("--role-discovery") || DEFAULT_ROLE_DISCOVERY_PATH,
    runLive: !process.argv.includes("--skip-live"),
    postCompatibilityCleanup: process.argv.includes("--post-compat-cleanup"),
  });
  const outPath = readArg("--out");
  if (outPath) writeVerifierEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectVerifierEvidence,
  writeVerifierEvidence,
  readDiscoveredRole,
  sanitize,
};

if (require.main === module) main();
