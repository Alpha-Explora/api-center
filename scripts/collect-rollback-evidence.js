#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_ROLLBACK_ENV = {
  REGISTRY_SOURCE: "redis",
  DATABASE_DUAL_WRITE: "false",
};

const OPTIONAL_ENV = ["DATABASE_ENABLED", "REGISTRY_DUAL_WRITE"];
const PREVIOUS_IMAGE_ENV_NAMES = [
  "API_CENTER_PREVIOUS_IMAGE",
  "API_CENTER_ROLLBACK_IMAGE",
  "PREVIOUS_API_CENTER_IMAGE",
  "ROLLBACK_IMAGE",
];

function collectRollbackEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  previousImage,
} = {}) {
  const explicitPreviousImage = previousImage || firstPresentEnv(env, PREVIOUS_IMAGE_ENV_NAMES);
  const manifestImage = readGkeManifestImage(
    path.join(repoRoot, "infra", "gcp", "gke", "30-deployment.yaml"),
  );
  const environment = Object.fromEntries(
    Object.entries(EXPECTED_ROLLBACK_ENV).map(([name, expectedValue]) => [
      name,
      rollbackEnvStatus(env, name, expectedValue),
    ]),
  );

  for (const name of OPTIONAL_ENV) {
    environment[name] = redactedEnvStatus(env, name);
  }

  const blockers = [];
  for (const [name, status] of Object.entries(environment)) {
    if (!Object.prototype.hasOwnProperty.call(EXPECTED_ROLLBACK_ENV, name)) continue;
    if (!status.present) blockers.push(name + " is not set for rollback.");
    else if (!status.matchesExpected) blockers.push(name + " must be " + status.expectedValue + " for rollback.");
  }

  if (!explicitPreviousImage) {
    blockers.push("Previous API Center image is not set; provide --previous-image or one of " + PREVIOUS_IMAGE_ENV_NAMES.join(", ") + ".");
  }

  return {
    generatedAt: now,
    repoRoot,
    expectedRollbackEnv: EXPECTED_ROLLBACK_ENV,
    environment,
    previousImage: explicitPreviousImage
      ? { present: true, source: previousImage ? "argument" : "environment", value: explicitPreviousImage }
      : { present: false },
    manifestImage: manifestImage ? { present: true, value: manifestImage } : { present: false },
    ready: blockers.length === 0,
    blockers,
    rollbackCommands: buildRollbackCommands(explicitPreviousImage),
  };
}

function buildRollbackCommands(previousImage) {
  return [
    "Set REGISTRY_SOURCE=redis in the live API Center environment.",
    "Set DATABASE_DUAL_WRITE=false in the live API Center environment.",
    previousImage
      ? "Redeploy or roll back API Center to image " + previousImage + "."
      : "Capture the previous API Center image tag before applying the migration.",
    "Run API Center readiness and Management readiness before switching registry source again.",
  ];
}

function rollbackEnvStatus(env, name, expectedValue) {
  const value = env[name];
  const present = typeof value === "string" && value.length > 0;
  return {
    present,
    redactedValue: present ? "<present>" : undefined,
    expectedValue,
    matchesExpected: present ? value.toLowerCase() === expectedValue.toLowerCase() : false,
  };
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  const present = typeof value === "string" && value.length > 0;
  return { present, redactedValue: present ? "<present>" : undefined };
}

function firstPresentEnv(env, names) {
  for (const name of names) {
    if (typeof env[name] === "string" && env[name].length > 0) return env[name];
  }
  return undefined;
}

function readGkeManifestImage(filePath) {
  const content = readOptional(filePath);
  if (!content) return undefined;
  const match = content.match(/^\s*-?\s*image:\s*(\S+)\s*$/m);
  return match ? match[1] : undefined;
}

function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function writeRollbackEvidence(evidence, outPath) {
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
  const evidence = collectRollbackEvidence({ previousImage: readArg("--previous-image") });
  const outPath = readArg("--out");
  if (outPath) writeRollbackEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectRollbackEvidence,
  writeRollbackEvidence,
};

if (require.main === module) {
  main();
}
