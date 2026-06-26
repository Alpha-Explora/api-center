#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function collectCompatCleanupK8sEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  loader = loadKubernetesObjects,
} = {}) {
  const namespace = readText(env.K8S_NAMESPACE) || "api-center";
  const deploymentName = readText(env.K8S_API_CENTER_DEPLOYMENT) || "api-center";
  const minWindowMinutes = parsePositiveInteger(
    env.APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES,
    60,
  );
  const blockers = [];
  let loaded;
  try {
    loaded = loader({ namespace, deploymentName, env });
  } catch (error) {
    loaded = { error: error && error.message ? error.message : String(error) };
  }

  const deployment = loaded?.deployment;
  const pods = loaded?.pods;
  if (loaded?.error) blockers.push("Kubernetes metadata could not be loaded: " + loaded.error);
  if (!deployment) blockers.push("Kubernetes deployment metadata is missing.");
  if (!pods) blockers.push("Kubernetes pod metadata is missing.");

  const deploymentSummary = deployment ? summarizeDeployment(deployment) : {};
  const podSummary = pods ? summarizePods(pods) : { pods: [] };
  const endedAt = parseTimestamp(now);
  const startedAt = podSummary.oldestReadyStartedAt || parseTimestamp(deploymentSummary.progressedAt);
  const durationMinutes = startedAt && endedAt
    ? Math.floor((endedAt.getTime() - startedAt.getTime()) / 60000)
    : undefined;

  if (deployment && deploymentSummary.desiredReplicas !== deploymentSummary.readyReplicas) {
    blockers.push("Kubernetes deployment ready replica count does not match desired replicas.");
  }
  if (deployment && deploymentSummary.desiredReplicas !== deploymentSummary.updatedReplicas) {
    blockers.push("Kubernetes deployment updated replica count does not match desired replicas.");
  }
  if (pods && podSummary.readyPods < deploymentSummary.desiredReplicas) {
    blockers.push("Kubernetes ready pod count is lower than desired replicas.");
  }
  if (durationMinutes !== undefined && durationMinutes < minWindowMinutes) {
    blockers.push("Kubernetes ready pod window is shorter than the required minimum.");
  }
  if (!deploymentSummary.image) blockers.push("Kubernetes deployment image is missing.");
  if (!startedAt) blockers.push("Kubernetes stable-window start time could not be inferred.");

  return {
    generatedAt: now,
    repoRoot,
    namespace,
    deployment: {
      name: deploymentName,
      image: deploymentSummary.image,
      kubernetesRevision: deploymentSummary.kubernetesRevision,
      generation: deploymentSummary.generation,
      observedGeneration: deploymentSummary.observedGeneration,
      desiredReplicas: deploymentSummary.desiredReplicas,
      readyReplicas: deploymentSummary.readyReplicas,
      updatedReplicas: deploymentSummary.updatedReplicas,
      progressedAt: deploymentSummary.progressedAt,
      revision: deploymentSummary.image
        ? "deployment/" + deploymentName + "@" + (deploymentSummary.kubernetesRevision || "unknown") + " " + deploymentSummary.image
        : undefined,
    },
    pods: podSummary.pods,
    window: {
      source: "kubernetes_ready_pods",
      startedAt: startedAt ? startedAt.toISOString() : undefined,
      endedAt: endedAt ? endedAt.toISOString() : undefined,
      durationMinutes,
      requiredMinutes: minWindowMinutes,
    },
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Wait until all ready API Center pods have been running for the required stable window.",
      "Run npm run db:compat-cleanup:k8s -- --out docs/operations/compat-cleanup-k8s-<date>.json.",
      "Use the deployment.revision value as APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION when generating stability evidence.",
    ],
  };
}

function loadKubernetesObjects({ namespace, deploymentName, env }) {
  const deploymentRun = runKubectl(["-n", namespace, "get", "deployment", deploymentName, "-o", "json"], env);
  if (deploymentRun.status !== 0) {
    throw new Error(sanitize(deploymentRun.stderr || deploymentRun.stdout || deploymentRun.error || "kubectl deployment query failed"));
  }
  const podsRun = runKubectl([
    "-n",
    namespace,
    "get",
    "pods",
    "-l",
    "app.kubernetes.io/name=" + deploymentName,
    "-o",
    "json",
  ], env);
  if (podsRun.status !== 0) {
    throw new Error(sanitize(podsRun.stderr || podsRun.stdout || podsRun.error || "kubectl pod query failed"));
  }
  return {
    deployment: JSON.parse(deploymentRun.stdout),
    pods: JSON.parse(podsRun.stdout),
  };
}

function summarizeDeployment(deployment) {
  const container = deployment?.spec?.template?.spec?.containers?.find((item) => item.name === "api-center")
    || deployment?.spec?.template?.spec?.containers?.[0];
  const progressing = (deployment?.status?.conditions || []).find((condition) => condition.type === "Progressing");
  return {
    image: container?.image,
    kubernetesRevision: deployment?.metadata?.annotations?.["deployment.kubernetes.io/revision"],
    generation: deployment?.metadata?.generation,
    observedGeneration: deployment?.status?.observedGeneration,
    desiredReplicas: deployment?.spec?.replicas || 0,
    readyReplicas: deployment?.status?.readyReplicas || 0,
    updatedReplicas: deployment?.status?.updatedReplicas || 0,
    progressedAt: progressing?.lastUpdateTime,
  };
}

function summarizePods(pods) {
  const rows = [];
  let oldestReadyStartedAt;
  for (const pod of pods?.items || []) {
    const statuses = pod?.status?.containerStatuses || [];
    const ready = pod?.status?.phase === "Running" && statuses.some((status) => status.ready === true);
    const startedAt = parseTimestamp(pod?.status?.startTime || pod?.metadata?.creationTimestamp);
    if (ready && startedAt && (!oldestReadyStartedAt || startedAt < oldestReadyStartedAt)) {
      oldestReadyStartedAt = startedAt;
    }
    rows.push({
      name: pod?.metadata?.name,
      phase: pod?.status?.phase,
      ready,
      startedAt: startedAt ? startedAt.toISOString() : undefined,
      restartCount: statuses.reduce((total, status) => total + (status.restartCount || 0), 0),
    });
  }
  return {
    readyPods: rows.filter((pod) => pod.ready).length,
    oldestReadyStartedAt,
    pods: rows,
  };
}

function runKubectl(args, env) {
  const result = spawnSync("kubectl", args, {
    env,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : undefined,
  };
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

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/redis:\/\/\S+/gi, "<redacted-redis-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function writeCompatCleanupK8sEvidence(evidence, outPath) {
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
  const evidence = collectCompatCleanupK8sEvidence();
  const outPath = readArg("--out");
  if (outPath) writeCompatCleanupK8sEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (process.argv.includes("--fail-on-blockers") && !evidence.ready) process.exitCode = 1;
}

module.exports = {
  collectCompatCleanupK8sEvidence,
  writeCompatCleanupK8sEvidence,
  sanitize,
};

if (require.main === module) main();
