const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectCompatCleanupK8sEvidence,
  writeCompatCleanupK8sEvidence,
} = require("./collect-compat-cleanup-k8s-evidence.js");

function run(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compat-cleanup-k8s-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function deploymentFixture() {
  return {
    metadata: {
      annotations: { "deployment.kubernetes.io/revision": "6" },
      generation: 6,
      name: "api-center",
      namespace: "api-center",
    },
    spec: {
      replicas: 2,
      template: {
        spec: {
          containers: [
            {
              name: "api-center",
              image: "registry.example/api-center:supabase-registry-sourcefix-512551d-20260626075800",
            },
          ],
        },
      },
    },
    status: {
      availableReplicas: 2,
      readyReplicas: 2,
      updatedReplicas: 2,
      observedGeneration: 6,
      conditions: [
        {
          type: "Progressing",
          status: "True",
          lastUpdateTime: "2026-06-26T00:03:32Z",
        },
      ],
    },
  };
}

function podsFixture(startedAt) {
  return {
    items: [
      {
        metadata: { name: "api-center-a", creationTimestamp: startedAt },
        status: {
          startTime: startedAt,
          phase: "Running",
          containerStatuses: [{ name: "api-center", ready: true, restartCount: 0 }],
        },
      },
      {
        metadata: { name: "api-center-b", creationTimestamp: startedAt },
        status: {
          startTime: startedAt,
          phase: "Running",
          containerStatuses: [{ name: "api-center", ready: true, restartCount: 0 }],
        },
      },
    ],
  };
}

run("marks Kubernetes deployment stable when all ready pods exceed the window", () => {
  const evidence = collectCompatCleanupK8sEvidence({
    now: "2026-06-26T02:00:00.000Z",
    env: { APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60" },
    loader: () => ({
      deployment: deploymentFixture(),
      pods: podsFixture("2026-06-26T00:45:00Z"),
    }),
  });

  assert.equal(evidence.ready, true);
  assert.equal(evidence.deployment.image, "registry.example/api-center:supabase-registry-sourcefix-512551d-20260626075800");
  assert.equal(evidence.deployment.revision, "deployment/api-center@6 registry.example/api-center:supabase-registry-sourcefix-512551d-20260626075800");
  assert.equal(evidence.window.durationMinutes, 75);
  assert.deepEqual(evidence.blockers, []);
});

run("blocks Kubernetes deployment evidence when ready pods are too new", () => {
  const evidence = collectCompatCleanupK8sEvidence({
    now: "2026-06-26T01:00:00.000Z",
    env: { APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60" },
    loader: () => ({
      deployment: deploymentFixture(),
      pods: podsFixture("2026-06-26T00:15:00Z"),
    }),
  });

  assert.equal(evidence.ready, false);
  assert.equal(evidence.blockers.includes("Kubernetes ready pod window is shorter than the required minimum."), true);
});

run("writes Kubernetes evidence to disk", () => {
  withTempRepo((repoRoot) => {
    const evidence = collectCompatCleanupK8sEvidence({
      repoRoot,
      env: {},
      loader: () => ({ deployment: deploymentFixture(), pods: podsFixture("2026-06-26T00:15:00Z") }),
    });
    const outPath = path.join(repoRoot, "docs", "operations", "k8s.json");
    writeCompatCleanupK8sEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.deployment.name, "api-center");
  });
});
