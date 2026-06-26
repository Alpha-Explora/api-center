#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_READINESS_PATH = "docs/operations/compat-cleanup-readiness-2026-06-26.json";
const DEFAULT_JSON_OUT = "docs/operations/compat-cleanup-command-packet-2026-06-26.json";
const DEFAULT_MD_OUT = "docs/operations/compat-cleanup-command-packet-2026-06-26.md";

function buildCompatCleanupCommandPacket({
  repoRoot = path.resolve(__dirname, ".."),
  now = new Date().toISOString(),
  readinessPath = DEFAULT_READINESS_PATH,
} = {}) {
  const readiness = loadJson(path.resolve(repoRoot, readinessPath));
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const ready = readiness.ready === true && blockers.length === 0;
  const targetMigration = readiness.artifacts && readiness.artifacts.migrationStatic
    ? readiness.artifacts.migrationStatic
    : {};

  return {
    generatedAt: now,
    repoRoot,
    readiness: {
      path: readinessPath,
      ready: readiness.ready === true,
      confirmations: readiness.confirmations || {},
      runtimeLegacyReferences: readiness.runtimeLegacyReferences || {},
      blockers,
    },
    targetMigration: {
      path: targetMigration.path,
      present: targetMigration.present === true,
      staticReady: targetMigration.ready === true,
      blockers: targetMigration.blockers || [],
    },
    requiredInputs: [
      "APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT",
      "APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT or collector run time after the window completes",
      "APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION",
      "APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT=true",
      "APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true",
      "DATABASE_URL for the approved live Supabase project",
      "SUPABASE_DB_PASSWORD or linked Supabase CLI auth",
      "A reviewed dry-run showing only legacy compatibility view drops",
    ],
    phases: buildPhases({ ready }),
    ready,
    blockers,
  };
}

function buildPhases({ ready }) {
  return [
    {
      id: "confirm_cleanup_readiness",
      title: "Confirm compatibility cleanup readiness",
      blocked: !ready,
      commands: [
        "npm run db:compat-cleanup:k8s -- --out docs/operations/compat-cleanup-k8s-2026-06-26.json",
        "npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-2026-06-26.json",
        "npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json --fail-on-blockers",
        "npm run db:compat-cleanup:migration-static",
      ],
    },
    {
      id: "dry_run",
      title: "Dry-run compatibility cleanup migration",
      blocked: !ready,
      commands: [
        "npm run db:migration:push:dry",
        "npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json --fail-on-blockers",
      ],
    },
    {
      id: "apply_cleanup",
      title: "Apply compatibility cleanup after dry-run approval",
      blocked: !ready,
      commands: [
        "npm run db:migration:push",
        "npm run db:verifier:evidence -- --post-compat-cleanup --out docs/operations/supabase-verifier-readiness-2026-06-26.json",
        "npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json",
        "npm run db:logs:missing-table:evidence -- --out docs/operations/missing-table-log-scan-2026-06-26.json",
        "npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-2026-06-26.json",
      ],
    },
  ];
}

function renderCompatCleanupCommandPacketMarkdown(packet) {
  const lines = [];
  lines.push("# APICenter Compatibility Cleanup Command Packet");
  lines.push("");
  lines.push("Generated: " + packet.generatedAt);
  lines.push("");
  lines.push("Cleanup ready: " + (packet.ready ? "yes" : "no"));
  lines.push("Readiness artifact: `" + packet.readiness.path + "`");
  lines.push("Target migration: `" + (packet.targetMigration.path || "<missing>") + "`");
  lines.push("Stable deployment confirmed: " + boolText(packet.readiness.confirmations.stableDeploymentConfirmed));
  lines.push("Cleanup approved: " + boolText(packet.readiness.confirmations.cleanupApproved));
  lines.push("Runtime legacy references: " + (packet.readiness.runtimeLegacyReferences.count ?? "<unknown>"));
  lines.push("");
  lines.push("## Required Inputs");
  lines.push("");
  for (const input of packet.requiredInputs) lines.push("- `" + input + "`");
  lines.push("");
  lines.push("Approval checkpoint: Do not set approval flags inside the packet. `APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true` must come from an explicit operator approval in the shell or deployment context before dry-run/apply commands are run.");
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
  lines.push("## Blockers");
  lines.push("");
  if (packet.blockers.length === 0) {
    lines.push("- No cleanup blockers.");
  } else {
    for (const blocker of packet.blockers) lines.push("- " + blocker);
  }
  lines.push("");
  return sanitize(lines.join("\n"));
}

function writeCompatCleanupCommandPacket(packet, jsonOut, mdOut) {
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(packet, null, 2) + "\n", "utf8");
  }
  if (mdOut) {
    fs.mkdirSync(path.dirname(mdOut), { recursive: true });
    fs.writeFileSync(mdOut, renderCompatCleanupCommandPacketMarkdown(packet), "utf8");
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function boolText(value) {
  return value === true ? "yes" : "no";
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
  const packet = buildCompatCleanupCommandPacket({
    readinessPath: readArg("--readiness") || DEFAULT_READINESS_PATH,
  });
  const jsonOut = path.resolve(readArg("--out") || DEFAULT_JSON_OUT);
  const mdOut = path.resolve(readArg("--md-out") || DEFAULT_MD_OUT);
  writeCompatCleanupCommandPacket(packet, jsonOut, mdOut);
  console.log(JSON.stringify({
    ready: packet.ready,
    phases: packet.phases.length,
    blockers: packet.blockers.length,
    jsonOut,
    mdOut,
  }, null, 2));
  if (!packet.ready && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  buildCompatCleanupCommandPacket,
  renderCompatCleanupCommandPacketMarkdown,
  writeCompatCleanupCommandPacket,
  sanitize,
};

if (require.main === module) main();
