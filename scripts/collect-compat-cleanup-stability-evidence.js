#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  scanRuntimeLegacyReferences,
} = require("./collect-compat-cleanup-readiness-evidence.js");

const DEFAULT_PATHS = {
  readiness: "docs/operations/readiness-new-2026-06-26.json",
  missingTableLogs: "docs/operations/missing-table-log-scan-2026-06-26.json",
  postcutoverErrors: "docs/operations/postcutover-error-log-scan-2026-06-26.json",
  verifier: "docs/operations/supabase-verifier-readiness-2026-06-26.json",
  k8s: "docs/operations/compat-cleanup-k8s-2026-06-26.json",
};

function collectCompatCleanupStabilityEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  workspaceRoot = path.resolve(path.resolve(__dirname, ".."), ".."),
  env = process.env,
  now = new Date().toISOString(),
  paths = DEFAULT_PATHS,
} = {}) {
  const normalizedPaths = { ...DEFAULT_PATHS, ...paths };
  const blockers = [];
  const minWindowMinutes = parsePositiveInteger(
    env.APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES,
    60,
  );
  const windowStartedAt = parseTimestamp(env.APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT);
  const windowEndedAt = parseTimestamp(env.APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT) || parseTimestamp(now);
  const deploymentRevision = readText(env.APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION);
  const runtimeLegacyReferences = scanRuntimeLegacyReferences(repoRoot, workspaceRoot);
  const readiness = readReadyArtifact(repoRoot, normalizedPaths.readiness);
  const missingTableLogs = readReadyArtifact(repoRoot, normalizedPaths.missingTableLogs);
  const postcutoverErrors = readReadyArtifact(repoRoot, normalizedPaths.postcutoverErrors);
  const verifier = readReadyArtifact(repoRoot, normalizedPaths.verifier);
  const verifierModes = verifier.present && verifier.data ? collectVerifierModes(verifier.data) : [];
  const inferredWindow = inferWindowFromReadiness(readiness.data, now);
  const k8s = readReadyArtifact(repoRoot, normalizedPaths.k8s);
  const inferredK8sWindow = inferWindowFromK8s(k8s.data);
  for (const artifact of [readiness, missingTableLogs, postcutoverErrors, verifier, k8s]) {
    delete artifact.data;
  }

  const effectiveStartedAt = windowStartedAt || inferredWindow.startedAt;
  const fallbackStartedAt = effectiveStartedAt || inferredK8sWindow.startedAt;
  const effectiveEndedAt = windowStartedAt ? windowEndedAt : inferredWindow.endedAt || inferredK8sWindow.endedAt || windowEndedAt;
  const effectiveDeploymentRevision = deploymentRevision || inferredWindow.deploymentRevision || inferredK8sWindow.deploymentRevision;
  const durationMinutes = fallbackStartedAt && effectiveEndedAt
    ? Math.floor((effectiveEndedAt.getTime() - fallbackStartedAt.getTime()) / 60000)
    : undefined;

  if (!fallbackStartedAt) blockers.push("Stable deployment window start time is missing.");
  if (!effectiveEndedAt) blockers.push("Stable deployment window end time is missing or invalid.");
  if (durationMinutes !== undefined && durationMinutes < minWindowMinutes) {
    blockers.push("Stable deployment window is shorter than the required minimum.");
  }
  if (!effectiveDeploymentRevision) blockers.push("Stable deployment revision is missing.");
  if (runtimeLegacyReferences.count > 0) blockers.push("Runtime code still references legacy control-plane schemas.");
  addArtifactBlockers(blockers, "New deployment readiness", readiness);
  addArtifactBlockers(blockers, "Missing-table log scan", missingTableLogs);
  addArtifactBlockers(blockers, "Post-cutover error log scan", postcutoverErrors);
  addArtifactBlockers(blockers, "Control-plane verifier", verifier);
  if (verifier.present && !verifierModes.includes("compat_views")) {
    blockers.push("Control-plane verifier evidence does not include the compatibility-view mode.");
  }

  return {
    generatedAt: now,
    repoRoot,
    workspaceRoot,
    window: {
      source: windowStartedAt ? "explicit" : inferredWindow.source || inferredK8sWindow.source,
      startedAt: fallbackStartedAt ? fallbackStartedAt.toISOString() : undefined,
      endedAt: effectiveEndedAt ? effectiveEndedAt.toISOString() : undefined,
      durationMinutes,
      requiredMinutes: minWindowMinutes,
      deploymentRevision: effectiveDeploymentRevision,
    },
    paths: normalizedPaths,
    runtimeLegacyReferences,
    artifacts: {
      readiness,
      missingTableLogs,
      postcutoverErrors,
      verifier: {
        ...verifier,
        liveModes: verifierModes,
      },
      k8s,
    },
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Set APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT to the beginning of the stable deployment window.",
      "Set APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT after the window completes, or omit it to use the collector run time.",
      "Set APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION to the API Center/Management deployment revision observed during the window.",
      "Run npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-<date>.json.",
    ],
  };
}

function inferWindowFromK8s(k8s) {
  if (!k8s || !k8s.window || !k8s.deployment?.revision) return {};
  const startedAt = parseTimestamp(k8s.window.startedAt);
  const endedAt = parseTimestamp(k8s.window.endedAt);
  if (!startedAt || !endedAt) return {};
  return {
    source: k8s.window.source || "kubernetes_ready_pods",
    startedAt,
    endedAt,
    deploymentRevision: k8s.deployment.revision,
  };
}

function inferWindowFromReadiness(readiness, fallbackNow) {
  if (!readiness || readiness.ready !== true) return {};
  const generatedAt = parseTimestamp(readiness.generatedAt) || parseTimestamp(fallbackNow);
  const uptimeSeconds = findApiCenterUptimeSeconds(readiness);
  const apiCenterRevision = findApiCenterRevision(readiness);
  const managementRevision = findManagementRevision(readiness);
  if (!generatedAt || !uptimeSeconds || !apiCenterRevision || !managementRevision) return {};
  return {
    source: "readiness_uptime",
    startedAt: new Date(generatedAt.getTime() - uptimeSeconds * 1000),
    endedAt: generatedAt,
    deploymentRevision: apiCenterRevision + " / " + managementRevision,
  };
}

function findApiCenterUptimeSeconds(readiness) {
  for (const endpoint of readiness.apiCenter?.endpoints || []) {
    const uptime = endpoint?.body?.info?.process?.uptime || endpoint?.body?.details?.process?.uptime;
    if (Number.isFinite(uptime) && uptime > 0) return Math.floor(uptime);
  }
  return undefined;
}

function findApiCenterRevision(readiness) {
  for (const endpoint of readiness.apiCenter?.endpoints || []) {
    const imageTag =
      endpoint?.body?.info?.governance?.imageTag ||
      endpoint?.body?.details?.governance?.imageTag;
    const revision = readText(imageTag);
    if (revision && revision !== "local") return revision;
  }
  return undefined;
}

function findManagementRevision(readiness) {
  for (const endpoint of readiness.management?.endpoints || []) {
    const raw = endpoint?.body?.raw;
    const match = typeof raw === "string" ? raw.match(/\bdata-dpl-id=["']([^"']+)["']/i) : undefined;
    if (match) return match[1];
    const data = endpoint?.body?.data;
    const revision = readText(data?.deploymentId || data?.deploymentRevision || data?.vercelDeploymentId);
    if (revision) return revision;
  }
  return undefined;
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

function addArtifactBlockers(blockers, label, artifact) {
  if (!artifact.present) {
    blockers.push(label + " evidence is missing.");
    return;
  }
  if (!artifact.ready) blockers.push(label + " evidence is not ready.");
  for (const blocker of artifact.blockers || []) blockers.push(label + ": " + blocker);
}

function parseTimestamp(value) {
  const text = readText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readText(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function writeCompatCleanupStabilityEvidence(evidence, outPath) {
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
  const evidence = collectCompatCleanupStabilityEvidence();
  const outPath = readArg("--out");
  if (outPath) writeCompatCleanupStabilityEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (process.argv.includes("--fail-on-blockers") && !evidence.ready) process.exitCode = 1;
}

module.exports = {
  collectCompatCleanupStabilityEvidence,
  writeCompatCleanupStabilityEvidence,
};

if (require.main === module) main();
