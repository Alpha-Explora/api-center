#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  findCleanupMigration,
  runCompatCleanupMigrationChecks,
} = require("./check-compat-cleanup-migration.js");

const DEFAULT_PATHS = {
  readiness: "docs/operations/readiness-new-2026-06-26.json",
  missingTableLogs: "docs/operations/missing-table-log-scan-2026-06-26.json",
  postcutoverErrors: "docs/operations/postcutover-error-log-scan-2026-06-26.json",
  verifier: "docs/operations/supabase-verifier-readiness-2026-06-26.json",
  stableWindow: "docs/operations/compat-cleanup-stability-2026-06-26.json",
};

const LEGACY_SCHEMA_PATTERN = /\b(api_center|api_center_ops|api_center_audit)\./g;

function collectCompatCleanupReadinessEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  workspaceRoot = path.resolve(path.resolve(__dirname, ".."), ".."),
  env = process.env,
  now = new Date().toISOString(),
  paths = DEFAULT_PATHS,
} = {}) {
  const normalizedPaths = { ...DEFAULT_PATHS, ...paths };
  const blockers = [];
  const cleanupApproved = readBoolean(env.APICENTER_COMPATIBILITY_CLEANUP_APPROVED);
  const runtimeLegacyReferences = scanRuntimeLegacyReferences(repoRoot, workspaceRoot);
  const readiness = readReadyArtifact(repoRoot, normalizedPaths.readiness);
  const missingTableLogs = readReadyArtifact(repoRoot, normalizedPaths.missingTableLogs);
  const postcutoverErrors = readReadyArtifact(repoRoot, normalizedPaths.postcutoverErrors);
  const verifier = readReadyArtifact(repoRoot, normalizedPaths.verifier);
  const stableWindow = readReadyArtifact(repoRoot, normalizedPaths.stableWindow);
  const stableDeploymentConfirmed =
    readBoolean(env.APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT) ||
    stableWindow.ready === true;
  const verifierModes = verifier.present ? collectVerifierModes(verifier.data) : [];
  const migrationStatic = collectMigrationStaticArtifact(repoRoot);
  for (const artifact of [readiness, missingTableLogs, postcutoverErrors, verifier, stableWindow]) {
    delete artifact.data;
  }

  if (!stableDeploymentConfirmed) blockers.push("One stable deployment window has not been explicitly confirmed.");
  if (!cleanupApproved) blockers.push("Compatibility cleanup has not been explicitly approved.");
  if (runtimeLegacyReferences.count > 0) blockers.push("Runtime code still references legacy control-plane schemas.");
  addArtifactBlockers(blockers, "New deployment readiness", readiness);
  addArtifactBlockers(blockers, "Missing-table log scan", missingTableLogs);
  addArtifactBlockers(blockers, "Post-cutover error log scan", postcutoverErrors);
  addArtifactBlockers(blockers, "Control-plane verifier", verifier);
  if (stableWindow.present && !stableWindow.ready) {
    addArtifactBlockers(blockers, "Stable deployment window", stableWindow);
  }
  if (!migrationStatic.ready) blockers.push("Compatibility cleanup migration static verification failed.");
  if (verifier.present && !hasValidVerifierMode(verifierModes)) {
    blockers.push("Control-plane verifier evidence does not include compatibility-view or legacy-schema-absence mode.");
  }

  return {
    generatedAt: now,
    repoRoot,
    workspaceRoot,
    paths: normalizedPaths,
    confirmations: {
      stableDeploymentConfirmed,
      cleanupApproved,
    },
    runtimeLegacyReferences,
    artifacts: {
      readiness,
      missingTableLogs,
      postcutoverErrors,
      verifier: {
        ...verifier,
        liveModes: verifierModes,
      },
      stableWindow,
      migrationStatic,
    },
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Confirm one full stable deployment window with no running API Center or Management deployment querying legacy control-plane schemas.",
      "Run npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-<date>.json after the window completes.",
      "Set APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT=true and APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true only after that confirmation and operator approval.",
      "Run npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-<date>.json --fail-on-blockers before live dry-run/apply.",
    ],
  };
}

function collectMigrationStaticArtifact(repoRoot) {
  const migrationPath = findCleanupMigration(repoRoot);
  const blockers = runCompatCleanupMigrationChecks({ repoRoot });
  return {
    path: migrationPath ? path.relative(repoRoot, migrationPath).replace(/\\/g, "/") : undefined,
    present: Boolean(migrationPath),
    ready: blockers.length === 0,
    blockers,
  };
}

function scanRuntimeLegacyReferences(repoRoot, workspaceRoot = path.resolve(repoRoot, "..")) {
  const targets = [
    { repo: "api-center", target: path.join(repoRoot, "src") },
    { repo: "api-center", target: path.join(repoRoot, "prisma", "schema.prisma") },
    { repo: "apicenter-management", target: path.join(workspaceRoot, "apicenter-management", "src") },
    { repo: "apicenter-management", target: path.join(workspaceRoot, "apicenter-management", "app") },
    { repo: "apicenter-management", target: path.join(workspaceRoot, "apicenter-management", "lib") },
  ];
  const matches = [];
  for (const { repo, target } of targets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) scanDirectory(repo, target, matches);
    else scanFile(repo, target, matches);
  }
  return { count: matches.length, matches: matches.slice(0, 50) };
}

function scanDirectory(repo, dir, matches) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage" || entry.name === ".next") continue;
      scanDirectory(repo, fullPath, matches);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|jsx|prisma)$/.test(entry.name)) scanFile(repo, fullPath, matches);
  }
}

function scanFile(repo, filePath, matches) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!LEGACY_SCHEMA_PATTERN.test(line)) {
      LEGACY_SCHEMA_PATTERN.lastIndex = 0;
      continue;
    }
    LEGACY_SCHEMA_PATTERN.lastIndex = 0;
    matches.push({
      repo,
      file: filePath,
      line: index + 1,
      text: line.trim().slice(0, 240),
    });
  }
}

function readReadyArtifact(repoRoot, relPath) {
  const artifactPath = path.resolve(repoRoot, relPath);
  try {
    const data = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    return {
      path: relPath,
      present: true,
      ready: data.ready === true,
      blockers,
      data,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { path: relPath, present: false, ready: false, blockers: ["Artifact is missing."] };
    }
    return {
      path: relPath,
      present: true,
      ready: false,
      blockers: ["Artifact could not be parsed: " + (error && error.message ? error.message : String(error))],
    };
  }
}

function collectVerifierModes(artifact) {
  if (!artifact || !Array.isArray(artifact.liveRuns)) return [];
  return artifact.liveRuns.map((run) => run && run.id).filter(Boolean);
}

function hasValidVerifierMode(verifierModes) {
  return verifierModes.includes("compat_views") || verifierModes.includes("legacy_schemas_absent");
}

function addArtifactBlockers(blockers, label, artifact) {
  if (!artifact.present) {
    blockers.push(label + " evidence is missing.");
    return;
  }
  if (!artifact.ready) blockers.push(label + " evidence is not ready.");
  for (const blocker of artifact.blockers || []) blockers.push(label + ": " + blocker);
}

function readBoolean(value) {
  return /^(true|1|yes|approved)$/i.test(String(value || "").trim());
}

function writeCompatCleanupReadinessEvidence(evidence, outPath) {
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
  const evidence = collectCompatCleanupReadinessEvidence();
  const outPath = readArg("--out");
  if (outPath) writeCompatCleanupReadinessEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (process.argv.includes("--fail-on-blockers") && !evidence.ready) process.exitCode = 1;
}

module.exports = {
  collectCompatCleanupReadinessEvidence,
  writeCompatCleanupReadinessEvidence,
  scanRuntimeLegacyReferences,
  collectMigrationStaticArtifact,
};

if (require.main === module) main();
