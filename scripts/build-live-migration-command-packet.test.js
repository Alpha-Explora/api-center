const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildLiveMigrationCommandPacket,
  renderLiveMigrationCommandPacketMarkdown,
  writeLiveMigrationCommandPacket,
  sanitize,
} = require("./build-live-migration-command-packet.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-live-command-packet-"));
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

const approvalPacketPath = "docs/operations/approval.json";

run("builds command packet from blocked approval packet", () => {
  withTempRepo({
    [approvalPacketPath]: {
      summary: { ready: 1, total: 16, blocked: 15, approvalReady: false },
      gates: [
        {
          id: "target_project",
          label: "Target Supabase project and environment",
          status: "blocked",
          evidence: "docs/operations/preflight.json",
          detail: "Linked project ref qnebjcboppqdsgmgizvs; config project id api-center-control-plane; Codex MCP project ref hguyivbodlrmooayuxwt.",
          blockers: ["Codex Supabase MCP project ref hguyivbodlrmooayuxwt does not match linked Supabase project ref qnebjcboppqdsgmgizvs."],
          nextAction: "Confirm target.",
        },
        {
          id: "static_migration_guard",
          label: "Static enterprise migration DDL guard",
          status: "ready",
          evidence: "docs/operations/verifier.json",
          blockers: [],
        },
      ],
    },
  }, (repoRoot) => {
    const packet = buildLiveMigrationCommandPacket({
      repoRoot,
      now: "2026-06-26T00:00:00.000Z",
      approvalPacketPath,
    });

    assert.equal(packet.ready, false);
    assert.equal(packet.target.linkedProjectRef, "qnebjcboppqdsgmgizvs");
    assert.equal(packet.target.codexMcpProjectRef, "hguyivbodlrmooayuxwt");
    assert.equal(packet.target.projectRefMismatch, true);
    assert.equal(packet.blockedGates.length, 1);
    assert.equal(packet.phases.some((phase) => phase.commands.some((command) => command.includes("--fail-on-pre-apply-blockers"))), true);
  });
});

run("uses linked project ref in target commands", () => {
  withTempRepo({
    [approvalPacketPath]: {
      summary: { ready: 16, total: 16, blocked: 0, approvalReady: true, preApplyReady: true, preApplyBlocked: 0, postApplyBlocked: 0 },
      gates: [
        {
          id: "target_project",
          label: "Target Supabase project and environment",
          status: "ready",
          evidence: "docs/operations/preflight.json",
          detail: "Linked project ref qnebjcboppqdsgmgizvs; config project id api-center-control-plane; Codex MCP project ref qnebjcboppqdsgmgizvs.",
          blockers: [],
        },
      ],
    },
  }, (repoRoot) => {
    const packet = buildLiveMigrationCommandPacket({ repoRoot, approvalPacketPath });
    const targetPhase = packet.phases.find((phase) => phase.id === "confirm_target");
    assert.equal(targetPhase.commands.includes("$env:SUPABASE_TARGET_PROJECT_REF=\"qnebjcboppqdsgmgizvs\""), true);
    assert.equal(targetPhase.blocked, false);
    assert.equal(packet.ready, true);
  });
});

run("allows apply phase when only post-apply gates are blocked", () => {
  withTempRepo({
    [approvalPacketPath]: {
      summary: { ready: 14, total: 16, blocked: 2, approvalReady: false, preApplyReady: true, preApplyBlocked: 0, postApplyBlocked: 2 },
      gates: [
        {
          id: "target_project",
          label: "Target Supabase project and environment",
          status: "ready",
          evidence: "docs/operations/preflight.json",
          detail: "Linked project ref qnebjcboppqdsgmgizvs; config project id api-center-control-plane; Codex MCP project ref qnebjcboppqdsgmgizvs.",
          blockers: [],
          stage: "pre_apply",
        },
        {
          id: "schema_verifier",
          label: "Schema verifier required modes",
          status: "blocked",
          evidence: "docs/operations/verifier.json",
          blockers: ["enterprise tables missing"],
          stage: "post_apply",
        },
        {
          id: "registry_parity",
          label: "Redis/Postgres registry parity",
          status: "blocked",
          evidence: "docs/operations/registry-parity.json",
          blockers: ["apic_catalog.services missing"],
          stage: "post_apply",
        },
      ],
    },
  }, (repoRoot) => {
    const packet = buildLiveMigrationCommandPacket({ repoRoot, approvalPacketPath });
    const applyPhase = packet.phases.find((phase) => phase.id === "apply_and_cutover");
    const approvalPhase = packet.phases.find((phase) => phase.id === "approval_checkpoint");
    assert.equal(packet.ready, true);
    assert.equal(packet.preApplyBlockedGates.length, 0);
    assert.equal(packet.postApplyBlockedGates.length, 2);
    assert.equal(approvalPhase.blocked, false);
    assert.equal(applyPhase.blocked, false);
  });
});

run("renders markdown and writes outputs", () => {
  withTempRepo({
    [approvalPacketPath]: {
      summary: { ready: 0, total: 16, blocked: 16, approvalReady: false },
      gates: [
        {
          id: "backup",
          label: "Live backup or schema/data dump",
          status: "blocked",
          evidence: "docs/operations/backup.json",
          detail: "Artifact reports ready=false.",
          blockers: ["SUPABASE_ACCESS_TOKEN is not set."],
          nextAction: "Create dump.",
        },
      ],
    },
  }, (repoRoot) => {
    const packet = buildLiveMigrationCommandPacket({ repoRoot, approvalPacketPath });
    const markdown = renderLiveMigrationCommandPacketMarkdown(packet);
    assert.equal(markdown.includes("APICenter Supabase Live Migration Command Packet"), true);
    assert.equal(markdown.includes("npm run db:backup:evidence"), true);
    const jsonOut = path.join(repoRoot, "docs", "operations", "commands.json");
    const mdOut = path.join(repoRoot, "docs", "operations", "commands.md");
    writeLiveMigrationCommandPacket(packet, jsonOut, mdOut);
    assert.equal(fs.existsSync(jsonOut), true);
    assert.equal(fs.existsSync(mdOut), true);
  });
});

run("sanitizes sensitive strings", () => {
  const output = sanitize("postgresql://user:pass@example/db redis://localhost Bearer abc.def password=secret secret=value sbp_token");
  assert.equal(output.includes("postgresql://user"), false);
  assert.equal(output.includes("redis://localhost"), false);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("password=secret"), false);
  assert.equal(output.includes("secret=value"), false);
  assert.equal(output.includes("sbp_token"), false);
});
