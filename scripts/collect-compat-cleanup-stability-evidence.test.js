const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectCompatCleanupStabilityEvidence,
  writeCompatCleanupStabilityEvidence,
} = require("./collect-compat-cleanup-stability-evidence.js");

function run(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function withTempRepo(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compat-cleanup-stability-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function readyArtifact() {
  return { ready: true, blockers: [] };
}

run("marks stable window ready when duration and supporting artifacts are clean", () => {
  withTempRepo({
    "src/app.ts": "export const schema = 'apic_catalog';\n",
    "prisma/schema.prisma": "",
    "docs/operations/readiness-new.json": readyArtifact(),
    "docs/operations/missing-table.json": readyArtifact(),
    "docs/operations/postcutover-errors.json": readyArtifact(),
    "docs/operations/verifier.json": { ready: true, blockers: [], liveRuns: [{ id: "compat_views" }] },
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      now: "2026-06-26T02:00:00.000Z",
      env: {
        APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT: "2026-06-26T00:30:00.000Z",
        APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT: "2026-06-26T02:00:00.000Z",
        APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60",
        APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION: "api-center-abc123",
      },
      paths: {
        readiness: "docs/operations/readiness-new.json",
        missingTableLogs: "docs/operations/missing-table.json",
        postcutoverErrors: "docs/operations/postcutover-errors.json",
        verifier: "docs/operations/verifier.json",
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.window.durationMinutes, 90);
    assert.equal(evidence.runtimeLegacyReferences.count, 0);
    assert.deepEqual(evidence.blockers, []);
  });
});

run("blocks stable window evidence when window inputs are missing", () => {
  withTempRepo({
    "src/app.ts": "export const ok = true;\n",
    "docs/operations/readiness-new.json": readyArtifact(),
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      env: {},
      paths: {
        readiness: "docs/operations/readiness-new.json",
      },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("Stable deployment window start time is missing."), true);
    assert.equal(evidence.blockers.includes("Stable deployment revision is missing."), true);
  });
});

run("infers stable window from readiness uptime and deployment identity", () => {
  withTempRepo({
    "src/app.ts": "export const ok = true;\n",
    "prisma/schema.prisma": "",
    "docs/operations/readiness-new.json": {
      generatedAt: "2026-06-26T02:00:00.000Z",
      ready: true,
      blockers: [],
      apiCenter: {
        endpoints: [
          {
            name: "ready",
            ok: true,
            body: {
              info: {
                process: { uptime: 3900 },
                governance: { imageTag: "api-center:stable-123" },
              },
            },
          },
        ],
      },
      management: {
        endpoints: [
          {
            name: "home",
            ok: true,
            body: { raw: "<html data-dpl-id=\"dpl_stable123\"></html>" },
          },
        ],
      },
    },
    "docs/operations/missing-table.json": readyArtifact(),
    "docs/operations/postcutover-errors.json": readyArtifact(),
    "docs/operations/verifier.json": { ready: true, blockers: [], liveRuns: [{ id: "compat_views" }] },
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      now: "2026-06-26T02:00:30.000Z",
      env: {
        APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60",
      },
      paths: {
        readiness: "docs/operations/readiness-new.json",
        missingTableLogs: "docs/operations/missing-table.json",
        postcutoverErrors: "docs/operations/postcutover-errors.json",
        verifier: "docs/operations/verifier.json",
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.window.source, "readiness_uptime");
    assert.equal(evidence.window.durationMinutes, 65);
    assert.equal(evidence.window.deploymentRevision, "api-center:stable-123 / dpl_stable123");
  });
});

run("infers stable window from Kubernetes deployment evidence", () => {
  withTempRepo({
    "src/app.ts": "export const ok = true;\n",
    "prisma/schema.prisma": "",
    "docs/operations/readiness-new.json": readyArtifact(),
    "docs/operations/missing-table.json": readyArtifact(),
    "docs/operations/postcutover-errors.json": readyArtifact(),
    "docs/operations/verifier.json": { ready: true, blockers: [], liveRuns: [{ id: "compat_views" }] },
    "docs/operations/k8s.json": {
      ready: true,
      blockers: [],
      deployment: {
        revision: "deployment/api-center@6 registry.example/api-center:stable",
      },
      window: {
        source: "kubernetes_ready_pods",
        startedAt: "2026-06-26T00:45:00.000Z",
        endedAt: "2026-06-26T02:00:00.000Z",
        durationMinutes: 75,
      },
    },
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      now: "2026-06-26T02:00:30.000Z",
      env: {
        APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60",
      },
      paths: {
        readiness: "docs/operations/readiness-new.json",
        missingTableLogs: "docs/operations/missing-table.json",
        postcutoverErrors: "docs/operations/postcutover-errors.json",
        verifier: "docs/operations/verifier.json",
        k8s: "docs/operations/k8s.json",
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.window.source, "kubernetes_ready_pods");
    assert.equal(evidence.window.durationMinutes, 75);
    assert.equal(evidence.window.deploymentRevision, "deployment/api-center@6 registry.example/api-center:stable");
  });
});

run("uses not-yet-ready Kubernetes evidence to report a short stable window", () => {
  withTempRepo({
    "src/app.ts": "export const ok = true;\n",
    "prisma/schema.prisma": "",
    "docs/operations/readiness-new.json": readyArtifact(),
    "docs/operations/missing-table.json": readyArtifact(),
    "docs/operations/postcutover-errors.json": readyArtifact(),
    "docs/operations/verifier.json": { ready: true, blockers: [], liveRuns: [{ id: "compat_views" }] },
    "docs/operations/k8s.json": {
      ready: false,
      blockers: ["Kubernetes ready pod window is shorter than the required minimum."],
      deployment: {
        revision: "deployment/api-center@6 registry.example/api-center:stable",
      },
      window: {
        source: "kubernetes_ready_pods",
        startedAt: "2026-06-26T00:45:00.000Z",
        endedAt: "2026-06-26T01:30:00.000Z",
        durationMinutes: 45,
      },
    },
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      now: "2026-06-26T01:30:30.000Z",
      env: {
        APICENTER_COMPATIBILITY_CLEANUP_MIN_WINDOW_MINUTES: "60",
      },
      paths: {
        readiness: "docs/operations/readiness-new.json",
        missingTableLogs: "docs/operations/missing-table.json",
        postcutoverErrors: "docs/operations/postcutover-errors.json",
        verifier: "docs/operations/verifier.json",
        k8s: "docs/operations/k8s.json",
      },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.window.source, "kubernetes_ready_pods");
    assert.equal(evidence.window.durationMinutes, 45);
    assert.equal(evidence.window.deploymentRevision, "deployment/api-center@6 registry.example/api-center:stable");
    assert.equal(evidence.blockers.includes("Stable deployment window is shorter than the required minimum."), true);
  });
});

run("blocks stable window evidence when runtime still references legacy schemas", () => {
  withTempRepo({
    "src/app.ts": "const sql = 'select * from api_center.services';\n",
    "docs/operations/readiness-new.json": readyArtifact(),
    "docs/operations/missing-table.json": readyArtifact(),
    "docs/operations/postcutover-errors.json": readyArtifact(),
    "docs/operations/verifier.json": { ready: true, blockers: [], liveRuns: [{ id: "compat_views" }] },
  }, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({
      repoRoot,
      workspaceRoot: repoRoot,
      now: "2026-06-26T02:00:00.000Z",
      env: {
        APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT: "2026-06-26T00:30:00.000Z",
        APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT: "2026-06-26T02:00:00.000Z",
        APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION: "api-center-abc123",
      },
      paths: {
        readiness: "docs/operations/readiness-new.json",
        missingTableLogs: "docs/operations/missing-table.json",
        postcutoverErrors: "docs/operations/postcutover-errors.json",
        verifier: "docs/operations/verifier.json",
      },
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("Runtime code still references legacy control-plane schemas."), true);
  });
});

run("writes stability evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const evidence = collectCompatCleanupStabilityEvidence({ repoRoot, env: {} });
    const outPath = path.join(repoRoot, "docs", "operations", "compat-cleanup-stability.json");
    writeCompatCleanupStabilityEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.ready, false);
  });
});
