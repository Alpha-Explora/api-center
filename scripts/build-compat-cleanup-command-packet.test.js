const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildCompatCleanupCommandPacket,
  renderCompatCleanupCommandPacketMarkdown,
  writeCompatCleanupCommandPacket,
  sanitize,
} = require("./build-compat-cleanup-command-packet.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compat-cleanup-command-packet-"));
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

const readinessPath = "docs/operations/compat-cleanup-readiness.json";

function readyCleanupEvidence(overrides = {}) {
  return {
    ready: true,
    blockers: [],
    confirmations: {
      stableDeploymentConfirmed: true,
      cleanupApproved: true,
    },
    runtimeLegacyReferences: {
      count: 0,
      matches: [],
    },
    artifacts: {
      readiness: { ready: true, present: true, blockers: [] },
      missingTableLogs: { ready: true, present: true, blockers: [] },
      postcutoverErrors: { ready: true, present: true, blockers: [] },
      verifier: { ready: true, present: true, blockers: [], liveModes: ["base", "compat_views", "retention_policy"] },
      migrationStatic: {
        path: "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql",
        present: true,
        ready: true,
        blockers: [],
      },
    },
    ...overrides,
  };
}

run("blocks cleanup command phases when readiness is not approved", () => {
  withTempRepo({
    [readinessPath]: readyCleanupEvidence({
      ready: false,
      confirmations: {
        stableDeploymentConfirmed: false,
        cleanupApproved: false,
      },
      blockers: [
        "One stable deployment window has not been explicitly confirmed.",
        "Compatibility cleanup has not been explicitly approved.",
      ],
    }),
  }, (repoRoot) => {
    const packet = buildCompatCleanupCommandPacket({
      repoRoot,
      now: "2026-06-26T01:00:00.000Z",
      readinessPath,
    });

    assert.equal(packet.ready, false);
    assert.equal(packet.blockers.length, 2);
    assert.equal(packet.phases.every((phase) => phase.blocked === true), true);
    assert.equal(packet.readiness.confirmations.stableDeploymentConfirmed, false);
  });
});

run("does not render self-approval commands while cleanup is blocked", () => {
  withTempRepo({
    [readinessPath]: readyCleanupEvidence({
      ready: false,
      confirmations: {
        stableDeploymentConfirmed: true,
        cleanupApproved: false,
      },
      blockers: ["Compatibility cleanup has not been explicitly approved."],
    }),
  }, (repoRoot) => {
    const packet = buildCompatCleanupCommandPacket({
      repoRoot,
      now: "2026-06-26T01:00:00.000Z",
      readinessPath,
    });
    const markdown = renderCompatCleanupCommandPacketMarkdown(packet);

    assert.equal(packet.ready, false);
    assert.equal(markdown.includes("$env:APICENTER_COMPATIBILITY_CLEANUP_APPROVED=\"true\""), false);
    assert.equal(markdown.includes("Do not set approval flags inside the packet"), true);
  });
});

run("builds dry-run and apply phases when cleanup readiness is approved", () => {
  withTempRepo({
    [readinessPath]: readyCleanupEvidence(),
  }, (repoRoot) => {
    const packet = buildCompatCleanupCommandPacket({ repoRoot, readinessPath });
    const dryRun = packet.phases.find((phase) => phase.id === "dry_run");
    const apply = packet.phases.find((phase) => phase.id === "apply_cleanup");

    assert.equal(packet.ready, true);
    assert.equal(dryRun.blocked, false);
    assert.equal(apply.blocked, false);
    assert.equal(
      packet.phases.some((phase) => phase.commands.some((command) => command.includes("db:compat-cleanup:stability"))),
      true,
    );
    assert.equal(dryRun.commands.includes("npm run db:migration:push:dry"), true);
    assert.equal(apply.commands.includes("npm run db:migration:push"), true);
    assert.equal(apply.commands.includes("npm run db:verifier:evidence -- --post-compat-cleanup --out docs/operations/supabase-verifier-readiness-2026-06-26.json"), true);
    assert.equal(packet.targetMigration.path, "supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql");
  });
});

run("renders markdown and writes command packet outputs", () => {
  withTempRepo({
    [readinessPath]: readyCleanupEvidence(),
  }, (repoRoot) => {
    const packet = buildCompatCleanupCommandPacket({ repoRoot, readinessPath });
    const markdown = renderCompatCleanupCommandPacketMarkdown(packet);
    assert.equal(markdown.includes("APICenter Compatibility Cleanup Command Packet"), true);
    assert.equal(markdown.includes("npm run db:compat-cleanup:readiness"), true);
    const jsonOut = path.join(repoRoot, "docs", "operations", "compat-cleanup-command-packet.json");
    const mdOut = path.join(repoRoot, "docs", "operations", "compat-cleanup-command-packet.md");
    writeCompatCleanupCommandPacket(packet, jsonOut, mdOut);
    assert.equal(fs.existsSync(jsonOut), true);
    assert.equal(fs.existsSync(mdOut), true);
  });
});

run("sanitizes sensitive command-packet strings", () => {
  const output = sanitize("postgresql://user:pass@example/db redis://localhost Bearer abc.def password=secret secret=value sbp_token");
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("redis://localhost"), false);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("password=secret"), false);
  assert.equal(output.includes("secret=value"), false);
  assert.equal(output.includes("sbp_token"), false);
});
