#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_ENV = [
  "DATABASE_URL",
  "DATABASE_ENABLED",
  "DATABASE_DUAL_WRITE",
  "REGISTRY_SOURCE",
  "REGISTRY_DUAL_WRITE",
  "SUPABASE_DB_PASSWORD",
];

function collectLivePreflightEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
} = {}) {
  const supabase = collectSupabaseLink(repoRoot, env);
  const target = collectTargetConfirmation(env);
  const environment = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, redactedEnvStatus(env, name)]),
  );
  const blockers = REQUIRED_ENV.filter((name) => !environment[name].present).map(
    (name) => name + " is not set",
  );

  if (!supabase.projectRef) blockers.push("supabase/.temp/project-ref is not present");
  if (!supabase.configProjectId) blockers.push("supabase/config.toml project_id is not present");
  if (!target.expectedProjectRef) {
    blockers.push("SUPABASE_TARGET_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF is not set");
  }
  if (!target.environmentName) {
    blockers.push("APICENTER_ENVIRONMENT_NAME or SUPABASE_TARGET_ENVIRONMENT is not set");
  }
  if (target.expectedProjectRef && supabase.projectRef && target.expectedProjectRef !== supabase.projectRef) {
    blockers.push(
      "Expected target project ref " +
        target.expectedProjectRef +
        " does not match linked Supabase project ref " +
        supabase.projectRef +
        ".",
    );
  }
  if (supabase.codexMcpProjectRef && supabase.projectRef && supabase.codexMcpProjectRef !== supabase.projectRef) {
    blockers.push(
      "Codex Supabase MCP project ref " +
        supabase.codexMcpProjectRef +
        " does not match linked Supabase project ref " +
        supabase.projectRef +
        ".",
    );
  }

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    target,
    environment,
    blockers,
    nextCommands: [
      "npm run db:migration:list",
      "npm run db:migration:push:dry",
      "supabase db advisors",
      "npm run db:verify:control-plane -- --app-role <discovered-app-role>",
      "npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-compat-views",
      "npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-retention-policy",
    ],
  };
}

function collectSupabaseLink(repoRoot, env = process.env) {
  return {
    configProjectId: readConfigProjectId(path.join(repoRoot, "supabase", "config.toml")),
    projectRef: readTrimmed(path.join(repoRoot, "supabase", ".temp", "project-ref")),
    codexMcpProjectRef: readCodexMcpProjectRef(env),
  };
}

function readCodexMcpProjectRef(env) {
  return (
    normalizeProjectRef(env.CODEX_SUPABASE_MCP_PROJECT_REF) ||
    parseProjectRefFromUrl(env.CODEX_SUPABASE_MCP_URL)
  );
}

function collectTargetConfirmation(env) {
  return {
    expectedProjectRef:
      normalizeProjectRef(env.SUPABASE_TARGET_PROJECT_REF) ||
      normalizeProjectRef(env.EXPECTED_SUPABASE_PROJECT_REF),
    environmentName:
      normalizeProjectRef(env.APICENTER_ENVIRONMENT_NAME) ||
      normalizeProjectRef(env.SUPABASE_TARGET_ENVIRONMENT) ||
      normalizeProjectRef(env.DEPLOYMENT_ENVIRONMENT),
  };
}

function parseProjectRefFromUrl(url) {
  if (!url) return undefined;
  try {
    return normalizeProjectRef(new URL(url).searchParams.get("project_ref"));
  } catch (_error) {
    const match = String(url).match(/[?&]project_ref=([^&]+)/);
    return normalizeProjectRef(match ? decodeURIComponent(match[1]) : undefined);
  }
}

function normalizeProjectRef(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function readConfigProjectId(filePath) {
  const content = readOptional(filePath);
  if (!content) return undefined;
  const match = content.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m);
  return match?.[1];
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
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

function writeLivePreflightEvidence(evidence, outPath) {
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
  const evidence = collectLivePreflightEvidence();
  const outPath = readArg("--out");
  if (outPath) writeLivePreflightEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) {
    process.exitCode = 1;
  }
}

module.exports = {
  collectLivePreflightEvidence,
  writeLivePreflightEvidence,
  parseProjectRefFromUrl,
  collectTargetConfirmation,
};

if (require.main === module) {
  main();
}
