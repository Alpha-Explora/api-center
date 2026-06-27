#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const DEFAULT_INVENTORY = "docs/operations/legacy-service-migration-2026-06-28.json";
const DEFAULT_OUT = "docs/operations/legacy-secret-cleanup-2026-06-28.json";
const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const ACTOR = "codex-task-13";
const SOURCE_ALIASES = {
  "flow-ci": ["api-center-test-tribe-secret-aping-api"],
};

async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, "..");
  const inventoryPath = path.resolve(
    repoRoot,
    readArg(argv, "--inventory") || DEFAULT_INVENTORY,
  );
  const outPath = path.resolve(repoRoot, readArg(argv, "--out") || DEFAULT_OUT);
  const apply = argv.includes("--apply");
  const disableLegacy = argv.includes("--disable-legacy");
  const deleteAfterDays = safeDays(readArg(argv, "--delete-after-days") || "7");
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    "apicenter-alpha-20260623";
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + deleteAfterDays * 86400_000);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const plan = buildPlan(inventory, now, deleteAfter);

  const evidence = {
    generatedAt: now.toISOString(),
    mode: apply ? "apply" : "dry-run",
    project,
    payloadPolicy:
      "Secret payloads are read only to extract existing SHA-256 hashes for missing scoped targets. No hash or plaintext value is written to this artifact or stdout.",
    inventoryPath: path.relative(repoRoot, inventoryPath).replace(/\\/g, "/"),
    deleteAfter: deleteAfter.toISOString(),
    summary: summarizePlan(plan),
    scopedTargetMigrations: plan.scopedTargetMigrations.map(redactMigration),
    legacyDisablePlan: plan.legacyDisablePlan.map(redactDisablePlan),
    applied: {
      scopedTargetsCreated: [],
      legacyVersionsDisabled: [],
    },
    blockers: [],
    nextActions: [
      "Keep disabled legacy records through the rollback window.",
      "Delete legacy Secret Manager records only after deleteAfter if no rollback is needed.",
      "Remove APICENTER_LEGACY_* code paths after scoped auth remains green.",
    ],
  };

  if (apply) {
    const createdSources = new Set();
    for (const migration of plan.scopedTargetMigrations) {
      if (migration.targetExists) continue;
      const payload = readSecretPayload(project, migration.sourceName);
      const secretHashSha256 = extractSecretHash(payload, migration.sourceName);
      ensureSecretExists(project, migration.targetName);
      addSecretVersion(project, migration.targetName, {
        tribeId: migration.tribeId,
        environment: migration.environment,
        secretHashSha256,
        status: "active",
        rotationState: "active_current",
        migratedFrom: migration.sourceName,
        migratedAt: now.toISOString(),
        auditEvidence: [
          {
            action: "legacy_secret_scoped_copy",
            actor: ACTOR,
            occurredAt: now.toISOString(),
          },
        ],
      });
      createdSources.add(migration.sourceName);
      evidence.applied.scopedTargetsCreated.push({
        sourceName: migration.sourceName,
        targetName: migration.targetName,
        tribeId: migration.tribeId,
        environment: migration.environment,
      });
    }

    if (disableLegacy) {
      for (const cleanup of plan.legacyDisablePlan) {
        const unsafeMissingTargets = cleanup.requiredTargets.filter(
          (target) => !target.exists && !createdSources.has(target.sourceName),
        );
        if (unsafeMissingTargets.length > 0) {
          evidence.blockers.push(
            `${cleanup.name} was not disabled because required scoped targets are missing.`,
          );
          continue;
        }
        for (const version of cleanup.enabledVersions) {
          disableSecretVersion(project, cleanup.name, version.version);
          evidence.applied.legacyVersionsDisabled.push({
            name: cleanup.name,
            version: version.version,
            deleteAfter: deleteAfter.toISOString(),
          });
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      out: path.relative(repoRoot, outPath).replace(/\\/g, "/"),
      mode: evidence.mode,
      scopedTargetsToCreate: plan.scopedTargetMigrations.filter(
        (item) => !item.targetExists,
      ).length,
      legacySecretsToDisable: plan.legacyDisablePlan.length,
      disabledVersions: evidence.applied.legacyVersionsDisabled.length,
      blockers: evidence.blockers.length,
    }),
  );
  if (evidence.blockers.length > 0) process.exitCode = 1;
}

function buildPlan(inventory, now, deleteAfter) {
  const scopedNames = new Set(
    (inventory.secrets?.scopedSecrets || []).map((secret) => secret.name),
  );
  const legacyByName = new Map(
    (inventory.secrets?.legacySecrets || []).map((secret) => [secret.name, secret]),
  );
  const activeTribes = (inventory.catalog?.activeServices || []).filter(
    (service) => service.serviceType === "tribe",
  );
  const scopedTargetMigrations = [];

  for (const service of activeTribes) {
    for (const environment of service.environments || []) {
      const targetName = `api-center-tribe-secret-${service.serviceId}-${environment.environment}`;
      if (scopedNames.has(targetName)) {
        scopedTargetMigrations.push({
          tribeId: service.serviceId,
          environment: environment.environment,
          targetName,
          targetExists: true,
          sourceName: null,
        });
        continue;
      }
      const sourceName = findSourceSecret(service.serviceId, legacyByName);
      scopedTargetMigrations.push({
        tribeId: service.serviceId,
        environment: environment.environment,
        targetName,
        targetExists: false,
        sourceName,
        sourceAvailable: Boolean(sourceName),
      });
    }
  }

  const requiredBySource = new Map();
  for (const migration of scopedTargetMigrations) {
    if (!migration.sourceName) continue;
    const targets = requiredBySource.get(migration.sourceName) || [];
    targets.push({
      targetName: migration.targetName,
      environment: migration.environment,
      exists: migration.targetExists,
      sourceName: migration.sourceName,
    });
    requiredBySource.set(migration.sourceName, targets);
  }

  const legacyDisablePlan = (inventory.secrets?.legacySecrets || []).map(
    (secret) => ({
      name: secret.name,
      kind: secret.kind,
      enabledVersions: (secret.versions || []).filter(
        (version) => version.state === "ENABLED",
      ),
      requiredTargets: requiredBySource.get(secret.name) || [],
      deleteAfter: deleteAfter.toISOString(),
      disposition: dispositionForLegacySecret(secret.name, activeTribes),
    }),
  );

  return { scopedTargetMigrations, legacyDisablePlan, generatedAt: now };
}

function findSourceSecret(serviceId, legacyByName) {
  const candidates = [
    ...sourceAliases(serviceId),
    `api-center-test-tribe-secret-${serviceId}`,
    `api-center-tribe-secret-${serviceId}`,
  ];
  return candidates.find((candidate) => legacyByName.has(candidate)) || null;
}

function sourceAliases(serviceId) {
  return SOURCE_ALIASES[serviceId] || [];
}

function dispositionForLegacySecret(name, activeTribes) {
  const activeIds = new Set(activeTribes.map((service) => service.serviceId));
  const unscopedMatch = /^api-center-tribe-secret-(.+)$/.exec(name);
  const testPrefixedMatch = /^api-center-test-tribe-secret-(.+)$/.exec(name);
  const id = testPrefixedMatch?.[1] || unscopedMatch?.[1] || "";
  if (activeIds.has(id)) return "active_service_scoped_targets_ready_or_created";
  if (Object.entries(SOURCE_ALIASES).some(([, aliases]) => aliases.includes(name))) {
    return "active_service_alias_source_scoped_targets_ready_or_created";
  }
  return "retired_or_no_active_service";
}

function summarizePlan(plan) {
  const missingTargets = plan.scopedTargetMigrations.filter(
    (item) => !item.targetExists,
  );
  return {
    activeScopedTargets: plan.scopedTargetMigrations.length,
    missingScopedTargets: missingTargets.length,
    missingTargetsWithoutSource: missingTargets.filter((item) => !item.sourceName)
      .length,
    legacySecrets: plan.legacyDisablePlan.length,
    enabledLegacyVersions: plan.legacyDisablePlan.reduce(
      (sum, item) => sum + item.enabledVersions.length,
      0,
    ),
  };
}

function redactMigration(migration) {
  return {
    tribeId: migration.tribeId,
    environment: migration.environment,
    sourceName: migration.sourceName,
    targetName: migration.targetName,
    targetExists: migration.targetExists,
    sourceAvailable: migration.sourceAvailable,
  };
}

function redactDisablePlan(cleanup) {
  return {
    name: cleanup.name,
    kind: cleanup.kind,
    enabledVersionCount: cleanup.enabledVersions.length,
    enabledVersions: cleanup.enabledVersions.map((version) => ({
      version: version.version,
      state: version.state,
    })),
    requiredTargets: cleanup.requiredTargets.map((target) => ({
      targetName: target.targetName,
      environment: target.environment,
      exists: target.exists,
    })),
    disposition: cleanup.disposition,
    deleteAfter: cleanup.deleteAfter,
  };
}

function ensureSecretExists(project, name) {
  try {
    runGcloud(["secrets", "describe", name, `--project=${project}`, "--format=value(name)"]);
  } catch {
    runGcloud([
      "secrets",
      "create",
      name,
      `--project=${project}`,
      "--replication-policy=automatic",
    ]);
  }
}

function addSecretVersion(project, name, payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apic-secret-"));
  const tempFile = path.join(tempDir, "payload.json");
  try {
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
    runGcloud([
      "secrets",
      "versions",
      "add",
      name,
      `--project=${project}`,
      `--data-file=${tempFile}`,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readSecretPayload(project, name) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apic-legacy-secret-"));
  const tempFile = path.join(tempDir, "payload.bin");
  try {
    runGcloud([
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${name}`,
      `--project=${project}`,
      `--out-file=${tempFile}`,
    ]);
    return fs.readFileSync(tempFile, "utf8");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractSecretHash(rawPayload, name) {
  const normalized = rawPayload.replace(/^\uFEFF/, "").trim();
  if (SHA_256_HEX_PATTERN.test(normalized)) return normalized.toLowerCase();
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`Legacy secret '${name}' payload is not a SHA-256 hash or JSON.`);
  }
  const hash =
    typeof parsed.secretHashSha256 === "string"
      ? parsed.secretHashSha256.trim().toLowerCase()
      : "";
  if (!SHA_256_HEX_PATTERN.test(hash)) {
    throw new Error(`Legacy secret '${name}' secretHashSha256 is malformed.`);
  }
  return hash;
}

function disableSecretVersion(project, name, version) {
  runGcloud([
    "secrets",
    "versions",
    "disable",
    String(version),
    `--secret=${name}`,
    `--project=${project}`,
    "--quiet",
  ]);
}

function runGcloud(args) {
  if (process.platform === "win32") {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& gcloud ${args.map(quotePowerShellArg).join(" ")}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  }
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeDays(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

module.exports = {
  buildPlan,
  summarizePlan,
  extractSecretHash,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
