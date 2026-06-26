#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_APPROVAL_PACKET = "docs/operations/supabase-migration-approval-packet-2026-06-26.json";
const DEFAULT_JSON_OUT = "docs/operations/supabase-live-command-packet-2026-06-26.json";
const DEFAULT_MD_OUT = "docs/operations/supabase-live-command-packet-2026-06-26.md";

function buildLiveMigrationCommandPacket({
  repoRoot = path.resolve(__dirname, ".."),
  now = new Date().toISOString(),
  approvalPacketPath = DEFAULT_APPROVAL_PACKET,
} = {}) {
  const approvalPacket = loadJson(path.resolve(repoRoot, approvalPacketPath));
  const gates = Array.isArray(approvalPacket.gates) ? approvalPacket.gates : [];
  const blockedGates = gates.filter((gate) => gate.status !== "ready");
  const preApplyBlockedGates = blockedGates.filter((gate) => gate.stage !== "post_apply");
  const postApplyBlockedGates = blockedGates.filter((gate) => gate.stage === "post_apply");
  const linkedProjectRef = extractLinkedProjectRef(approvalPacket);
  const codexMcpProjectRef = extractCodexMcpProjectRef(approvalPacket);

  return {
    generatedAt: now,
    repoRoot,
    approvalPacket: {
      path: approvalPacketPath,
      ready: approvalPacket.summary && approvalPacket.summary.approvalReady === true,
      preApplyReady: approvalPacket.summary && approvalPacket.summary.preApplyReady === true,
      gatesReady: approvalPacket.summary && approvalPacket.summary.ready,
      gatesTotal: approvalPacket.summary && approvalPacket.summary.total,
      gatesBlocked: approvalPacket.summary && approvalPacket.summary.blocked,
      preApplyBlocked: approvalPacket.summary && approvalPacket.summary.preApplyBlocked,
      postApplyBlocked: approvalPacket.summary && approvalPacket.summary.postApplyBlocked,
    },
    target: {
      linkedProjectRef,
      codexMcpProjectRef,
      projectRefMismatch: Boolean(linkedProjectRef && codexMcpProjectRef && linkedProjectRef !== codexMcpProjectRef),
    },
    requiredInputs: requiredInputs(),
    phases: buildPhases({ blockedGates, preApplyBlockedGates, postApplyBlockedGates, linkedProjectRef }),
    preApplyBlockedGates: preApplyBlockedGates.map(serializeGate),
    postApplyBlockedGates: postApplyBlockedGates.map(serializeGate),
    blockedGates: blockedGates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      evidence: gate.evidence,
      blockers: gate.blockers || [],
      nextAction: gate.nextAction,
    })),
    ready: approvalPacket.summary && approvalPacket.summary.preApplyReady === true,
    blockers: blockedGates.map((gate) => gate.id + ": " + (gate.blockers || []).join("; ")),
  };
}

function requiredInputs() {
  return [
    "SUPABASE_TARGET_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF",
    "APICENTER_ENVIRONMENT_NAME or SUPABASE_TARGET_ENVIRONMENT",
    "DATABASE_URL",
    "Supabase CLI OAuth login or SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "DATABASE_ENABLED",
    "DATABASE_DUAL_WRITE",
    "REGISTRY_SOURCE",
    "REGISTRY_DUAL_WRITE",
    "APICENTER_MIGRATION_ROLLOUT_STRATEGY",
    "API_CENTER_BASE_URL or APICENTER_URL",
    "MANAGEMENT_BASE_URL or APICENTER_MANAGEMENT_URL",
    "REDIS_CACHE_URL or REDIS_URL or CACHE_URL",
    "API_CENTER_PREVIOUS_IMAGE or API_CENTER_ROLLBACK_IMAGE",
    "API_CENTER_LOG_FILE or API_CENTER_LOG_DIR for post-cutover log scans",
  ];
}

function serializeGate(gate) {
  return {
    id: gate.id,
    label: gate.label,
    evidence: gate.evidence,
    blockers: gate.blockers || [],
    nextAction: gate.nextAction,
  };
}

function buildPhases({ blockedGates, preApplyBlockedGates, postApplyBlockedGates, linkedProjectRef }) {
  const blockedIds = new Set(blockedGates.map((gate) => gate.id));
  const preApplyBlockedIds = new Set(preApplyBlockedGates.map((gate) => gate.id));
  const postApplyBlockedIds = new Set(postApplyBlockedGates.map((gate) => gate.id));
  return [
    {
      id: "confirm_target",
      title: "Confirm target project and environment",
      gateIds: ["target_project", "live_env", "rollout_strategy"],
      blocked: hasAny(blockedIds, ["target_project", "live_env", "rollout_strategy"]),
      commands: [
        "$env:SUPABASE_TARGET_PROJECT_REF=\"" + (linkedProjectRef || "<linked-project-ref>") + "\"",
        "$env:APICENTER_ENVIRONMENT_NAME=\"<test|uat|prod>\"",
        "$env:CODEX_SUPABASE_MCP_PROJECT_REF=\"" + (linkedProjectRef || "<same-project-ref-as-supabase-link>") + "\"",
        "$env:APICENTER_MIGRATION_ROLLOUT_STRATEGY=\"compatibility_views\"",
        "$env:APICENTER_COMPATIBILITY_VIEWS_APPROVED=\"true\"",
        "npm run db:preflight:live -- --out docs/operations/supabase-live-preflight-2026-06-26.json",
        "npm run db:rollout-strategy:evidence -- --out docs/operations/migration-rollout-strategy-2026-06-26.json",
      ],
    },
    {
      id: "collect_preapproval_evidence",
      title: "Collect pre-approval Supabase evidence",
      gateIds: ["app_roles", "grant_alignment", "row_counts", "migration_history", "backup", "dry_run", "advisors"],
      blocked: hasAny(preApplyBlockedIds, ["app_roles", "grant_alignment", "row_counts", "migration_history", "backup", "dry_run", "advisors"]),
      commands: [
        "npm run db:discover:roles -- --out docs/operations/supabase-role-discovery-2026-06-26.json",
        "npm run db:grant-alignment:evidence -- --out docs/operations/grant-alignment-2026-06-26.json",
        "npm run db:row-counts:evidence -- --out docs/operations/supabase-row-counts-2026-06-26.json",
        "npm run db:migration-list:evidence -- --run-linked --out docs/operations/supabase-migration-list-2026-06-26.json",
        "npm run db:backup:evidence -- --run-dump --out docs/operations/supabase-backup-readiness-2026-06-26.json",
        "npm run db:dry-run:evidence -- --run-dry-run --out docs/operations/supabase-dry-run-readiness-2026-06-26.json",
        "npm run db:advisors:evidence -- --run-advisors --out docs/operations/supabase-advisors-readiness-2026-06-26.json",
      ],
    },
    {
      id: "safe_rollout_and_readiness",
      title: "Prove safe rollout mode and old/new readiness",
      gateIds: ["safe_rollout", "readiness", "rollback"],
      blocked: hasAny(blockedIds, ["safe_rollout", "readiness", "rollback"]),
      commands: [
        "$env:DATABASE_ENABLED=\"true\"",
        "$env:DATABASE_DUAL_WRITE=\"true\"",
        "$env:REGISTRY_SOURCE=\"redis\"",
        "$env:REGISTRY_DUAL_WRITE=\"true\"",
        "npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-2026-06-26.json",
        "npm run db:rollback:evidence -- --out docs/operations/api-center-rollback-readiness-2026-06-26.json",
        "npm run db:readiness:evidence -- --phase old --out docs/operations/readiness-old-2026-06-26.json",
        "npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json",
      ],
    },
    {
      id: "approval_checkpoint",
      title: "Regenerate approval packet and enforce no pre-apply blockers",
      gateIds: ["all"],
      blocked: preApplyBlockedGates.length > 0,
      commands: [
        "npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md --fail-on-pre-apply-blockers",
      ],
    },
    {
      id: "apply_and_cutover",
      title: "Apply migration after pre-apply approval, then prove post-apply gates",
      gateIds: ["operator_approval"],
      blocked: preApplyBlockedGates.length > 0,
      commands: [
        "npm run db:migration:push",
        "npm run db:verifier:evidence -- --out docs/operations/supabase-verifier-readiness-2026-06-26.json",
        "npm run db:registry-parity:evidence -- --out docs/operations/registry-parity-2026-06-26.json",
        "npm run registry:verify",
        "$env:REGISTRY_SOURCE=\"postgres\"",
        "npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json",
      ],
    },
    {
      id: "postcutover_monitoring",
      title: "Capture post-cutover monitoring evidence",
      gateIds: ["postcutover_logs", "compliance_export"],
      blocked: postApplyBlockedGates.length > 0,
      commands: [
        "npm run db:logs:missing-table:evidence -- --out docs/operations/missing-table-log-scan-2026-06-26.json",
        "npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-2026-06-26.json",
        "npm run db:compliance-export:evidence -- --out docs/operations/compliance-export-smoke-2026-06-26.json",
      ],
    },
  ];
}

function hasAny(set, ids) {
  return ids.some((id) => set.has(id));
}

function extractLinkedProjectRef(packet) {
  const targetGate = findGate(packet, "target_project");
  const detail = targetGate && targetGate.detail ? targetGate.detail : "";
  const match = detail.match(/Linked project ref\s+([a-z0-9]+)/i);
  return match ? match[1] : undefined;
}

function extractCodexMcpProjectRef(packet) {
  const targetGate = findGate(packet, "target_project");
  const detail = targetGate && targetGate.detail ? targetGate.detail : "";
  const match = detail.match(/Codex MCP project ref\s+([a-z0-9]+)/i);
  return match ? match[1] : undefined;
}

function findGate(packet, id) {
  return Array.isArray(packet.gates) ? packet.gates.find((gate) => gate.id === id) : undefined;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderLiveMigrationCommandPacketMarkdown(packet) {
  const lines = [];
  lines.push("# APICenter Supabase Live Migration Command Packet");
  lines.push("");
  lines.push("Generated: " + packet.generatedAt);
  lines.push("");
  lines.push("Approval ready: " + (packet.approvalPacket.ready ? "yes" : "no"));
  lines.push("Pre-apply ready: " + (packet.approvalPacket.preApplyReady ? "yes" : "no"));
  lines.push("Approval gates: " + packet.approvalPacket.gatesReady + "/" + packet.approvalPacket.gatesTotal + " ready");
  lines.push("Blocked gates: pre-apply " + (packet.approvalPacket.preApplyBlocked ?? 0) + "; post-apply " + (packet.approvalPacket.postApplyBlocked ?? 0));
  lines.push("Linked project ref: `" + (packet.target.linkedProjectRef || "<missing>") + "`");
  lines.push("Codex MCP project ref: `" + (packet.target.codexMcpProjectRef || "<missing>") + "`");
  lines.push("Project-ref mismatch: " + (packet.target.projectRefMismatch ? "yes" : "no"));
  lines.push("");
  lines.push("## Required Inputs");
  lines.push("");
  for (const input of packet.requiredInputs) lines.push("- `" + input + "`");
  lines.push("");
  lines.push("## Command Phases");
  lines.push("");
  for (const phase of packet.phases) {
    lines.push("### " + phase.title);
    lines.push("");
    lines.push("Blocked by current evidence: " + (phase.blocked ? "yes" : "no"));
    lines.push("");
    lines.push("```powershell");
    for (const command of phase.commands) lines.push(command);
    lines.push("```");
    lines.push("");
  }
  lines.push("## Blocked Gates");
  lines.push("");
  if (packet.blockedGates.length === 0) {
    lines.push("- No blocked approval gates.");
  } else {
    for (const gate of packet.blockedGates) {
      lines.push("- `" + gate.id + "`: " + gate.label + " (`" + gate.evidence + "`)");
      for (const blocker of gate.blockers) lines.push("  - " + blocker);
    }
  }
  lines.push("");
  lines.push("## Post-Apply Gates");
  lines.push("");
  if (packet.postApplyBlockedGates.length === 0) {
    lines.push("- No blocked post-apply gates.");
  } else {
    for (const gate of packet.postApplyBlockedGates) {
      lines.push("- `" + gate.id + "`: " + gate.label + " (`" + gate.evidence + "`)");
      for (const blocker of gate.blockers) lines.push("  - " + blocker);
    }
  }
  lines.push("");
  return sanitize(lines.join("\n"));
}

function writeLiveMigrationCommandPacket(packet, jsonOut, mdOut) {
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(packet, null, 2) + "\n", "utf8");
  }
  if (mdOut) {
    fs.mkdirSync(path.dirname(mdOut), { recursive: true });
    fs.writeFileSync(mdOut, renderLiveMigrationCommandPacketMarkdown(packet), "utf8");
  }
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

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function main() {
  const packet = buildLiveMigrationCommandPacket({
    approvalPacketPath: readArg("--approval-packet") || DEFAULT_APPROVAL_PACKET,
  });
  const jsonOut = path.resolve(readArg("--out") || DEFAULT_JSON_OUT);
  const mdOut = path.resolve(readArg("--md-out") || DEFAULT_MD_OUT);
  writeLiveMigrationCommandPacket(packet, jsonOut, mdOut);
  console.log(JSON.stringify({
    ready: packet.ready,
    phases: packet.phases.length,
    blockedGates: packet.blockedGates.length,
    jsonOut,
    mdOut,
  }, null, 2));
}

module.exports = {
  buildLiveMigrationCommandPacket,
  renderLiveMigrationCommandPacketMarkdown,
  writeLiveMigrationCommandPacket,
  sanitize,
};

if (require.main === module) main();
