const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectCompatCleanupReadinessEvidence,
  writeCompatCleanupReadinessEvidence,
} = require("./collect-compat-cleanup-readiness-evidence.js");
const {
  REQUIRED_COMPATIBILITY_VIEW_DROPS,
  REQUIRED_EMPTY_SCHEMA_DROPS,
} = require("./check-compat-cleanup-migration.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compat-cleanup-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function readyArtifact() {
  return JSON.stringify({ ready: true, blockers: [] });
}

function validVerifierArtifact() {
  return JSON.stringify({
    ready: true,
    blockers: [],
    liveRuns: [{ id: "base" }, { id: "compat_views" }, { id: "retention_policy" }],
  });
}

function validPostCleanupVerifierArtifact() {
  return JSON.stringify({
    ready: true,
    blockers: [],
    liveRuns: [{ id: "base" }, { id: "legacy_schemas_absent" }, { id: "retention_policy" }],
  });
}

function validCleanupMigration() {
  return [
    ...REQUIRED_COMPATIBILITY_VIEW_DROPS.map((view) => "drop view if exists " + view + ";"),
    ...REQUIRED_EMPTY_SCHEMA_DROPS.map((schema) => "drop schema if exists " + schema + ";"),
  ].join("\n") + "\n";
}

run("marks cleanup ready only after stable deployment proof and explicit approval", () => {
  withTempRepo(
    {
      "src/registry/registry.service.ts": "export const schema = 'apic_catalog';\n",
      "prisma/schema.prisma": "model Service { id String }\n",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": validVerifierArtifact(),
      "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql": validCleanupMigration(),
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        now: "2026-06-26T01:00:00.000Z",
        env: {
          APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT: "true",
          APICENTER_COMPATIBILITY_CLEANUP_APPROVED: "true",
        },
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.blockers, []);
      assert.equal(evidence.runtimeLegacyReferences.count, 0);
    },
  );
});

run("blocks cleanup when generated cleanup migration fails static verification", () => {
  withTempRepo(
    {
      "src/app.ts": "export const ok = true;\n",
      "prisma/schema.prisma": "",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": validVerifierArtifact(),
      "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql": "drop table api_center.services;\n",
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        env: {
          APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT: "true",
          APICENTER_COMPATIBILITY_CLEANUP_APPROVED: "true",
        },
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.artifacts.migrationStatic.ready, false);
      assert.equal(
        evidence.blockers.includes("Compatibility cleanup migration static verification failed."),
        true,
      );
    },
  );
});

run("accepts post-cleanup verifier evidence when legacy schemas are absent", () => {
  withTempRepo(
    {
      "src/registry/registry.service.ts": "export const schema = 'apic_catalog';\n",
      "prisma/schema.prisma": "model Service { id String }\n",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": validPostCleanupVerifierArtifact(),
      "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql": validCleanupMigration(),
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        now: "2026-06-26T01:00:00.000Z",
        env: {
          APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT: "true",
          APICENTER_COMPATIBILITY_CLEANUP_APPROVED: "true",
        },
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, true);
      assert.deepEqual(evidence.artifacts.verifier.liveModes, ["base", "legacy_schemas_absent", "retention_policy"]);
      assert.deepEqual(evidence.blockers, []);
    },
  );
});

run("blocks cleanup when stable deployment and approval are missing", () => {
  withTempRepo(
    {
      "src/app.ts": "export const ok = true;\n",
      "prisma/schema.prisma": "",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": JSON.stringify({
        ready: true,
        blockers: [],
        liveRuns: [{ id: "base" }, { id: "compat_views" }],
      }),
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        env: {},
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, false);
      assert.equal(
        evidence.blockers.includes("One stable deployment window has not been explicitly confirmed."),
        true,
      );
      assert.equal(
        evidence.blockers.includes("Compatibility cleanup has not been explicitly approved."),
        true,
      );
    },
  );
});

run("accepts ready stable-window artifact while still requiring cleanup approval", () => {
  withTempRepo(
    {
      "src/app.ts": "export const ok = true;\n",
      "prisma/schema.prisma": "",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": validVerifierArtifact(),
      "docs/operations/stability.json": JSON.stringify({ ready: true, blockers: [] }),
      "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql": validCleanupMigration(),
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        env: {},
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
          stableWindow: "docs/operations/stability.json",
        },
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.confirmations.stableDeploymentConfirmed, true);
      assert.equal(
        evidence.blockers.includes("One stable deployment window has not been explicitly confirmed."),
        false,
      );
      assert.equal(
        evidence.blockers.includes("Compatibility cleanup has not been explicitly approved."),
        true,
      );
    },
  );
});

run("blocks cleanup when runtime code still references legacy schemas", () => {
  withTempRepo(
    {
      "src/query.ts": "const sql = 'select * from api_center.services';\n",
      "prisma/schema.prisma": "",
      "docs/operations/readiness-new.json": readyArtifact(),
      "docs/operations/missing-table.json": readyArtifact(),
      "docs/operations/postcutover-errors.json": readyArtifact(),
      "docs/operations/verifier.json": JSON.stringify({
        ready: true,
        blockers: [],
        liveRuns: [{ id: "base" }, { id: "compat_views" }],
      }),
    },
    (repoRoot) => {
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        env: {
          APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT: "true",
          APICENTER_COMPATIBILITY_CLEANUP_APPROVED: "true",
        },
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.runtimeLegacyReferences.count, 1);
      assert.equal(
        evidence.blockers.includes("Runtime code still references legacy control-plane schemas."),
        true,
      );
    },
  );
});

run("blocks cleanup when Management still references legacy schemas", () => {
  withTempRepo(
    {
      "api-center/src/app.ts": "export const ok = true;\n",
      "api-center/prisma/schema.prisma": "",
      "apicenter-management/src/app/api/registry/route.ts": "const table = 'api_center_ops.service_registration_requests';\n",
      "api-center/docs/operations/readiness-new.json": readyArtifact(),
      "api-center/docs/operations/missing-table.json": readyArtifact(),
      "api-center/docs/operations/postcutover-errors.json": readyArtifact(),
      "api-center/docs/operations/verifier.json": JSON.stringify({
        ready: true,
        blockers: [],
        liveRuns: [{ id: "base" }, { id: "compat_views" }],
      }),
    },
    (workspaceRoot) => {
      const repoRoot = path.join(workspaceRoot, "api-center");
      const evidence = collectCompatCleanupReadinessEvidence({
        repoRoot,
        workspaceRoot,
        env: {
          APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT: "true",
          APICENTER_COMPATIBILITY_CLEANUP_APPROVED: "true",
        },
        paths: {
          readiness: "docs/operations/readiness-new.json",
          missingTableLogs: "docs/operations/missing-table.json",
          postcutoverErrors: "docs/operations/postcutover-errors.json",
          verifier: "docs/operations/verifier.json",
        },
      });

      assert.equal(evidence.ready, false);
      assert.equal(evidence.runtimeLegacyReferences.count, 1);
      assert.equal(evidence.runtimeLegacyReferences.matches[0].repo, "apicenter-management");
      assert.equal(
        evidence.blockers.includes("Runtime code still references legacy control-plane schemas."),
        true,
      );
    },
  );
});

run("writes cleanup readiness evidence to disk", () => {
  withTempRepo({}, (repoRoot) => {
    const evidence = collectCompatCleanupReadinessEvidence({ repoRoot, env: {} });
    const outPath = path.join(repoRoot, "docs", "operations", "compat-cleanup.json");
    writeCompatCleanupReadinessEvidence(evidence, outPath);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.ready, false);
  });
});
