#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_SAFE_ROLLOUT_ENV = {
  DATABASE_ENABLED: "true",
  DATABASE_DUAL_WRITE: "true",
  REGISTRY_SOURCE: "redis",
  REGISTRY_DUAL_WRITE: "true",
};

function collectSafeRolloutEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
} = {}) {
  const supabase = collectSupabaseLink(repoRoot);
  const environment = Object.fromEntries(
    Object.entries(EXPECTED_SAFE_ROLLOUT_ENV).map(([name, expectedValue]) => [
      name,
      expectedEnvStatus(env, name, expectedValue),
    ]),
  );
  const blockers = [];
  for (const [name, status] of Object.entries(environment)) {
    if (!status.present) blockers.push(name + " is not set for safe rollout mode.");
    else if (!status.matchesExpected) blockers.push(name + " must be " + status.expectedValue + " for safe rollout mode.");
  }

  return {
    generatedAt: now,
    repoRoot,
    supabase,
    expectedSafeRolloutEnv: EXPECTED_SAFE_ROLLOUT_ENV,
    environment,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Set DATABASE_ENABLED=true in the live API Center environment.",
      "Set DATABASE_DUAL_WRITE=true in the live API Center environment.",
      "Set REGISTRY_SOURCE=redis in the live API Center environment before applying DDL.",
      "Set REGISTRY_DUAL_WRITE=true in the live API Center environment.",
      "Rerun npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-<date>.json from the live operator shell.",
    ],
  };
}

function expectedEnvStatus(env, name, expectedValue) {
  const value = env[name];
  const present = typeof value === "string" && value.length > 0;
  return {
    present,
    redactedValue: present ? "<present>" : undefined,
    expectedValue,
    matchesExpected: present ? value.toLowerCase() === expectedValue.toLowerCase() : false,
  };
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

function writeSafeRolloutEvidence(evidence, outPath) {
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
  const evidence = collectSafeRolloutEvidence();
  const outPath = readArg("--out");
  if (outPath) writeSafeRolloutEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectSafeRolloutEvidence,
  writeSafeRolloutEvidence,
};

if (require.main === module) main();
