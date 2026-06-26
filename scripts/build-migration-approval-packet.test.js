const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildApprovalPacket, renderApprovalPacketMarkdown, writeApprovalPacket, sanitize, shouldFailOnBlockers } = require("./build-migration-approval-packet.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-approval-packet-"));
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

const artifacts = {
  preflight: "docs/operations/preflight.json",
  roleDiscovery: "docs/operations/roles.json",
  grantAlignment: "docs/operations/grant-alignment.json",
  rowCounts: "docs/operations/row-counts.json",
  verifier: "docs/operations/verifier.json",
  rolloutStrategy: "docs/operations/rollout-strategy.json",
  migrationList: "docs/operations/migration-list.json",
  safeRollout: "docs/operations/safe-rollout.json",
  registryParity: "docs/operations/registry-parity.json",
  rollback: "docs/operations/rollback.json",
  advisors: "docs/operations/advisors.json",
  backup: "docs/operations/backup.json",
  dryRun: "docs/operations/dry-run.json",
  readiness: "docs/operations/readiness-old.json",
};

run("builds blocked packet from incomplete evidence", () => {
  withTempRepo({
    "docs/operations/preflight.json": { supabase: { projectRef: "qnebjcboppqdsgmgizvs", configProjectId: "api-center-control-plane" }, environment: { DATABASE_ENABLED: { present: true } } },
    "docs/operations/roles.json": { blockers: ["DATABASE_URL is not set"], recommendedAppRoles: [] },
    "docs/operations/grant-alignment.json": { ready: false, blockers: ["Role discovery blocker: DATABASE_URL is not set"] },
    "docs/operations/row-counts.json": { ready: false, blockers: ["DATABASE_URL is not set."] },
    "docs/operations/verifier.json": { ready: false, blockers: ["DATABASE_URL is not set."], staticRun: { status: 1 } },
    "docs/operations/rollout-strategy.json": { ready: false, blockers: ["strategy missing"] },
    "docs/operations/migration-list.json": { ready: false, blockers: ["SUPABASE_ACCESS_TOKEN is not set."] },
    "docs/operations/safe-rollout.json": { ready: false, blockers: ["REGISTRY_SOURCE is not set for safe rollout mode."] },
    "docs/operations/registry-parity.json": { ready: false, blockers: ["DATABASE_URL is not set."] },
    "docs/operations/rollback.json": { ready: false, blockers: ["previous image missing"] },
    "docs/operations/advisors.json": { ready: false, blockers: ["token missing"] },
    "docs/operations/backup.json": { ready: false, backupFile: { present: false }, blockers: ["dump missing"] },
    "docs/operations/dry-run.json": { ready: false, blockers: ["backup missing"] },
    "docs/operations/readiness-old.json": { phase: "old", ready: true, blockers: [] },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, now: "2026-06-26T00:00:00.000Z", artifacts });
    assert.equal(packet.summary.approvalReady, false);
    assert.equal(packet.gates.length, 16);
    assert.equal(packet.gates.find((gate) => gate.id === "readiness").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "grant_alignment").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "row_counts").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "static_migration_guard").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "schema_verifier").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "rollout_strategy").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "migration_history").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "safe_rollout").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "registry_parity").status, "blocked");
    assert.equal(packet.gates.find((gate) => gate.id === "target_project").status, "blocked");
    assert.equal(packet.nextActions.length > 0, true);
  });
});

run("marks concrete evidence gates ready while keeping written project confirmation blocked", () => {
  withTempRepo({
    "docs/operations/preflight.json": { supabase: { projectRef: "qnebjcboppqdsgmgizvs", configProjectId: "api-center-control-plane" }, environment: { DATABASE_ENABLED: { present: true }, DATABASE_DUAL_WRITE: { present: true }, REGISTRY_SOURCE: { present: true }, REGISTRY_DUAL_WRITE: { present: true } } },
    "docs/operations/roles.json": { blockers: [], recommendedAppRoles: ["api_center_app"] },
    "docs/operations/grant-alignment.json": { ready: true, blockers: [], migrationGrantRoles: ["api_center_app"], discoveredAppRoles: ["api_center_app"] },
    "docs/operations/row-counts.json": { ready: true, blockers: [], rowCountRun: { status: 0 } },
    "docs/operations/verifier.json": { ready: true, blockers: [], staticRun: { status: 0 }, liveRuns: [{ id: "base" }, { id: "compat_views" }, { id: "retention_policy" }] },
    "docs/operations/rollout-strategy.json": { ready: true, blockers: [], strategy: "compatibility_views" },
    "docs/operations/migration-list.json": { ready: true, blockers: [], parsed: { linkedRows: [{ local: "20260625010101", remote: "20260625010101" }] } },
    "docs/operations/safe-rollout.json": { ready: true, blockers: [], environment: { REGISTRY_SOURCE: { matchesExpected: true } } },
    "docs/operations/registry-parity.json": { ready: true, blockers: [], parity: { matches: true, counts: { redis: 1, postgres: 1 } } },
    "docs/operations/rollback.json": { ready: true, blockers: [] },
    "docs/operations/advisors.json": { ready: true, blockers: [] },
    "docs/operations/backup.json": { ready: true, backupFile: { present: true }, blockers: [] },
    "docs/operations/dry-run.json": { ready: true, blockers: [] },
    "docs/operations/readiness-old.json": { phase: "old", ready: true, blockers: [] },
    "docs/operations/readiness-new.json": { phase: "new", ready: true, blockers: [] },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    assert.equal(packet.summary.approvalReady, false);
    assert.equal(packet.gates.find((gate) => gate.id === "live_env").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "readiness").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "grant_alignment").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "row_counts").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "static_migration_guard").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "schema_verifier").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "rollout_strategy").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "migration_history").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "safe_rollout").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "registry_parity").status, "ready");
    assert.equal(packet.gates.find((gate) => gate.id === "target_project").status, "blocked");
  });
});

run("marks target-project gate ready when expected project and environment match", () => {
  withTempRepo({
    "docs/operations/preflight.json": {
      supabase: {
        projectRef: "qnebjcboppqdsgmgizvs",
        configProjectId: "api-center-control-plane",
        codexMcpProjectRef: "qnebjcboppqdsgmgizvs",
      },
      target: {
        expectedProjectRef: "qnebjcboppqdsgmgizvs",
        environmentName: "test",
      },
      environment: {},
    },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    const targetGate = packet.gates.find((gate) => gate.id === "target_project");
    assert.equal(targetGate.status, "ready");
    assert.deepEqual(targetGate.blockers, []);
    assert.equal(targetGate.detail.includes("environment test"), true);
  });
});

run("keeps post-apply blockers out of pre-apply readiness", () => {
  withTempRepo({
    "docs/operations/preflight.json": {
      supabase: {
        projectRef: "qnebjcboppqdsgmgizvs",
        configProjectId: "api-center-control-plane",
      },
      target: {
        expectedProjectRef: "qnebjcboppqdsgmgizvs",
        environmentName: "test",
      },
      environment: {
        DATABASE_ENABLED: { present: true },
        DATABASE_DUAL_WRITE: { present: true },
        REGISTRY_SOURCE: { present: true },
        REGISTRY_DUAL_WRITE: { present: true },
      },
    },
    "docs/operations/roles.json": { blockers: [], recommendedAppRoles: ["api_center_app"] },
    "docs/operations/grant-alignment.json": { ready: true, blockers: [] },
    "docs/operations/row-counts.json": { ready: true, blockers: [] },
    "docs/operations/verifier.json": { ready: false, blockers: ["enterprise tables missing"], staticRun: { status: 0 } },
    "docs/operations/rollout-strategy.json": { ready: true, blockers: [] },
    "docs/operations/migration-list.json": { ready: true, blockers: [] },
    "docs/operations/safe-rollout.json": { ready: true, blockers: [] },
    "docs/operations/registry-parity.json": { ready: false, blockers: ["apic_catalog.services missing"] },
    "docs/operations/rollback.json": { ready: true, blockers: [] },
    "docs/operations/advisors.json": { ready: true, blockers: [] },
    "docs/operations/backup.json": { ready: true, backupFile: { present: true }, blockers: [] },
    "docs/operations/dry-run.json": { ready: true, blockers: [] },
    "docs/operations/readiness-old.json": { phase: "old", ready: true, blockers: [] },
    "docs/operations/readiness-new.json": { phase: "new", ready: true, blockers: [] },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    assert.equal(packet.summary.approvalReady, false);
    assert.equal(packet.summary.preApplyReady, true);
    assert.equal(packet.summary.preApplyBlocked, 0);
    assert.equal(packet.summary.postApplyBlocked, 2);
    assert.equal(packet.gates.find((gate) => gate.id === "schema_verifier").stage, "post_apply");
    assert.equal(packet.gates.find((gate) => gate.id === "registry_parity").stage, "post_apply");
  });
});

run("surfaces expected target project ref mismatches as target-project blockers", () => {
  withTempRepo({
    "docs/operations/preflight.json": {
      supabase: {
        projectRef: "qnebjcboppqdsgmgizvs",
        configProjectId: "api-center-control-plane",
      },
      target: {
        expectedProjectRef: "hguyivbodlrmooayuxwt",
        environmentName: "test",
      },
      environment: {},
    },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    const targetGate = packet.gates.find((gate) => gate.id === "target_project");
    assert.equal(targetGate.status, "blocked");
    assert.equal(
      targetGate.blockers.includes(
        "Expected target project ref hguyivbodlrmooayuxwt does not match linked Supabase project ref qnebjcboppqdsgmgizvs.",
      ),
      true,
    );
  });
});

run("surfaces Codex Supabase MCP project ref mismatches as target-project blockers", () => {
  withTempRepo({
    "docs/operations/preflight.json": {
      supabase: {
        projectRef: "qnebjcboppqdsgmgizvs",
        configProjectId: "api-center-control-plane",
        codexMcpProjectRef: "hguyivbodlrmooayuxwt",
      },
      environment: {},
    },
  }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    const targetGate = packet.gates.find((gate) => gate.id === "target_project");
    assert.equal(targetGate.status, "blocked");
    assert.equal(targetGate.detail.includes("Codex MCP project ref hguyivbodlrmooayuxwt"), true);
    assert.equal(
      targetGate.blockers.includes(
        "Codex Supabase MCP project ref hguyivbodlrmooayuxwt does not match linked Supabase project ref qnebjcboppqdsgmgizvs.",
      ),
      true,
    );
  });
});

run("renders markdown and writes packet outputs", () => {
  withTempRepo({ "docs/operations/preflight.json": { supabase: {}, environment: {} } }, (repoRoot) => {
    const packet = buildApprovalPacket({ repoRoot, artifacts });
    const markdown = renderApprovalPacketMarkdown(packet);
    assert.equal(markdown.includes("APICenter Supabase Migration Approval Packet"), true);
    assert.equal(markdown.includes("Gate Status"), true);
    const jsonOut = path.join(repoRoot, "docs", "operations", "packet.json");
    const mdOut = path.join(repoRoot, "docs", "operations", "packet.md");
    writeApprovalPacket(packet, jsonOut, mdOut);
    assert.equal(fs.existsSync(jsonOut), true);
    assert.equal(fs.existsSync(mdOut), true);
  });
});

run("detects fail-on-blockers mode only for blocked packets", () => {
  assert.equal(
    shouldFailOnBlockers({ summary: { approvalReady: false } }, ["node", "script", "--fail-on-blockers"]),
    true,
  );
  assert.equal(
    shouldFailOnBlockers({ summary: { approvalReady: false } }, ["node", "script"]),
    false,
  );
  assert.equal(
    shouldFailOnBlockers({ summary: { approvalReady: true } }, ["node", "script", "--fail-on-blockers"]),
    false,
  );
  assert.equal(
    shouldFailOnBlockers({ summary: { approvalReady: false, preApplyReady: true } }, ["node", "script", "--fail-on-pre-apply-blockers"]),
    false,
  );
  assert.equal(
    shouldFailOnBlockers({ summary: { approvalReady: false, preApplyReady: false } }, ["node", "script", "--fail-on-pre-apply-blockers"]),
    true,
  );
});

run("sanitizes sensitive strings", () => {
  const output = sanitize("postgresql://user:pass@example/db Bearer abc.def password=secret secret=value sbp_token");
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("password=secret"), false);
  assert.equal(output.includes("secret=value"), false);
  assert.equal(output.includes("sbp_token"), false);
});
