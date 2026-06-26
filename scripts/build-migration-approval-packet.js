#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ARTIFACTS = {
  preflight: "docs/operations/supabase-live-preflight-2026-06-26.json",
  roleDiscovery: "docs/operations/supabase-role-discovery-2026-06-26.json",
  grantAlignment: "docs/operations/grant-alignment-2026-06-26.json",
  rowCounts: "docs/operations/supabase-row-counts-2026-06-26.json",
  verifier: "docs/operations/supabase-verifier-readiness-2026-06-26.json",
  rolloutStrategy: "docs/operations/migration-rollout-strategy-2026-06-26.json",
  migrationList: "docs/operations/supabase-migration-list-2026-06-26.json",
  safeRollout: "docs/operations/api-center-safe-rollout-2026-06-26.json",
  registryParity: "docs/operations/registry-parity-2026-06-26.json",
  rollback: "docs/operations/api-center-rollback-readiness-2026-06-26.json",
  advisors: "docs/operations/supabase-advisors-readiness-2026-06-26.json",
  backup: "docs/operations/supabase-backup-readiness-2026-06-26.json",
  dryRun: "docs/operations/supabase-dry-run-readiness-2026-06-26.json",
  readiness: "docs/operations/readiness-prelive-2026-06-26.json",
};
const POST_APPLY_GATE_IDS = new Set(["schema_verifier", "registry_parity"]);

function buildApprovalPacket({ repoRoot = path.resolve(__dirname, ".."), now = new Date().toISOString(), artifacts = DEFAULT_ARTIFACTS } = {}) {
  const loaded = Object.fromEntries(Object.entries(artifacts).map(([key, relPath]) => [key, loadArtifact(repoRoot, relPath)]));
  const readinessArtifacts = loadReadinessArtifacts(repoRoot, artifacts.readiness);
  const gates = [
    gateFromPreflight(loaded.preflight),
    gateFromLiveEnv(loaded.preflight),
    gateFromRoleDiscovery(loaded.roleDiscovery),
    gateFromGrantAlignment(loaded.grantAlignment),
    gateFromRowCounts(loaded.rowCounts),
    gateFromStaticMigrationGuard(loaded.verifier),
    gateFromVerifier(loaded.verifier),
    gateFromRolloutStrategy(loaded.rolloutStrategy),
    gateFromMigrationList(loaded.migrationList),
    gateFromSafeRollout(loaded.safeRollout),
    gateFromRegistryParity(loaded.registryParity),
    gateFromBackup(loaded.backup),
    gateFromDryRun(loaded.dryRun),
    gateFromAdvisors(loaded.advisors),
    gateFromReadiness(readinessArtifacts),
    gateFromRollback(loaded.rollback),
  ];
  const stagedGates = gates.map((gate) => ({ ...gate, stage: POST_APPLY_GATE_IDS.has(gate.id) ? "post_apply" : "pre_apply" }));
  const blocked = stagedGates.filter((gate) => gate.status !== "ready");
  const preApplyBlocked = blocked.filter((gate) => gate.stage === "pre_apply");
  const postApplyBlocked = blocked.filter((gate) => gate.stage === "post_apply");
  return {
    generatedAt: now,
    repoRoot,
    summary: {
      ready: stagedGates.length - blocked.length,
      total: stagedGates.length,
      blocked: blocked.length,
      approvalReady: blocked.length === 0,
      preApplyReady: preApplyBlocked.length === 0,
      preApplyBlocked: preApplyBlocked.length,
      postApplyBlocked: postApplyBlocked.length,
    },
    artifacts: Object.fromEntries(Object.entries(loaded).map(([key, artifact]) => [key, artifactSummary(artifact)])),
    gates: stagedGates,
    nextActions: buildNextActions(stagedGates),
  };
}

function gateFromPreflight(artifact) {
  if (!artifact.present) return missingGate("target_project", "Target Supabase project and environment", artifact, "Run npm run db:preflight:live in the live operator shell.");
  const supabase = artifact.data && artifact.data.supabase ? artifact.data.supabase : {};
  const target = artifact.data && artifact.data.target ? artifact.data.target : {};
  const projectRef = supabase.projectRef;
  const projectId = supabase.configProjectId;
  const codexMcpProjectRef = supabase.codexMcpProjectRef;
  const expectedProjectRef = target.expectedProjectRef;
  const environmentName = target.environmentName;
  const blockers = [];
  if (!projectRef || !projectId) blockers.push("Supabase project reference or config project id is missing.");
  if (!expectedProjectRef) blockers.push("Expected target project ref is not captured in preflight evidence.");
  if (!environmentName) blockers.push("Target environment name is not captured in preflight evidence.");
  if (expectedProjectRef && projectRef && expectedProjectRef !== projectRef) {
    blockers.push("Expected target project ref " + expectedProjectRef + " does not match linked Supabase project ref " + projectRef + ".");
  }
  if (codexMcpProjectRef && projectRef && codexMcpProjectRef !== projectRef) {
    blockers.push("Codex Supabase MCP project ref " + codexMcpProjectRef + " does not match linked Supabase project ref " + projectRef + ".");
  }
  const mcpDetail = codexMcpProjectRef ? "; Codex MCP project ref " + codexMcpProjectRef : "";
  const targetDetail = expectedProjectRef || environmentName ? "; expected project ref " + (expectedProjectRef || "<missing>") + "; environment " + (environmentName || "<missing>") : "";
  return {
    id: "target_project",
    label: "Target Supabase project and environment",
    status: blockers.length === 0 ? "ready" : projectRef && projectId ? "blocked" : "missing_evidence",
    evidence: artifact.relPath,
    detail: projectRef && projectId ? "Linked project ref " + projectRef + "; config project id " + projectId + mcpDetail + targetDetail + "." : "Project ref or config project id missing.",
    blockers,
    nextAction: "Capture SUPABASE_TARGET_PROJECT_REF and APICENTER_ENVIRONMENT_NAME in preflight evidence, and ensure Codex MCP points at the same project before approval.",
  };
}

function gateFromLiveEnv(artifact) {
  if (!artifact.present) return missingGate("live_env", "Live API Center env flags", artifact, "Run npm run db:preflight:live in the live operator shell.");
  const env = artifact.data && artifact.data.environment ? artifact.data.environment : {};
  const names = ["DATABASE_ENABLED", "DATABASE_DUAL_WRITE", "REGISTRY_SOURCE", "REGISTRY_DUAL_WRITE"];
  const missing = names.filter((name) => !(env[name] && env[name].present));
  return {
    id: "live_env",
    label: "Live API Center env flags",
    status: missing.length === 0 ? "ready" : "blocked",
    evidence: artifact.relPath,
    detail: missing.length === 0 ? "Required live env flags were present in the preflight artifact." : "Required live env flags are missing from the current shell evidence.",
    blockers: missing.map((name) => name + " is not set."),
    nextAction: "Capture DATABASE_ENABLED, DATABASE_DUAL_WRITE, REGISTRY_SOURCE, and REGISTRY_DUAL_WRITE from the live deployment environment.",
  };
}

function gateFromRoleDiscovery(artifact) {
  if (!artifact.present) return missingGate("app_roles", "Runtime app role discovery", artifact, "Run npm run db:discover:roles against live DATABASE_URL.");
  const blockers = artifact.data && Array.isArray(artifact.data.blockers) ? artifact.data.blockers : [];
  const roles = artifact.data && Array.isArray(artifact.data.recommendedAppRoles) ? artifact.data.recommendedAppRoles : [];
  return {
    id: "app_roles",
    label: "Runtime app role discovery",
    status: blockers.length === 0 && roles.length > 0 ? "ready" : "blocked",
    evidence: artifact.relPath,
    detail: roles.length > 0 ? "Recommended app roles: " + roles.join(", ") + "." : "No runtime app role was discovered.",
    blockers: blockers.length ? blockers : roles.length ? [] : ["No recommended app role was discovered."],
    nextAction: "Run role discovery with DATABASE_URL, then apply least-privilege grants to explicit roles only.",
  };
}

function gateFromGrantAlignment(artifact) {
  if (!artifact.present) return missingGate("grant_alignment", "Migration grants match discovered app roles", artifact, "Run npm run db:grant-alignment:evidence after live role discovery.");
  return readinessGate("grant_alignment", "Migration grants match discovered app roles", artifact, "Update migration grant targets from live role discovery and rerun grant-alignment evidence before approval.");
}

function gateFromRowCounts(artifact) {
  if (!artifact.present) return missingGate("row_counts", "Live row-count inventory", artifact, "Run npm run db:row-counts:evidence in the live operator shell with DATABASE_URL set.");
  return readinessGate("row_counts", "Live row-count inventory", artifact, "Capture live registry/control-plane row counts before applying DDL.");
}

function gateFromStaticMigrationGuard(artifact) {
  if (!artifact.present) return missingGate("static_migration_guard", "Static enterprise migration DDL guard", artifact, "Run npm run db:verifier:evidence so the static migration verifier result is captured.");
  const staticRun = artifact.data && artifact.data.staticRun ? artifact.data.staticRun : undefined;
  const blockers = [];
  if (!staticRun) blockers.push("Static enterprise migration verifier result is missing.");
  else if (staticRun.status !== 0) blockers.push("Static enterprise migration verifier failed.");
  return {
    id: "static_migration_guard",
    label: "Static enterprise migration DDL guard",
    status: blockers.length === 0 ? "ready" : "blocked",
    evidence: artifact.relPath,
    detail: blockers.length === 0 ? "Static enterprise migration verifier passed." : "Static verifier is missing or failed.",
    blockers,
    nextAction: "Run npm run db:verify:enterprise-static and regenerate verifier evidence before approval.",
  };
}

function gateFromVerifier(artifact) {
  if (!artifact.present) return missingGate("schema_verifier", "Schema verifier required modes", artifact, "Run npm run db:verifier:evidence after DATABASE_URL and app role are available.");
  return readinessGate("schema_verifier", "Schema verifier required modes", artifact, "Run base, compatibility-view, and retention-policy verifier modes before approval.");
}

function gateFromRolloutStrategy(artifact) {
  if (!artifact.present) return missingGate("rollout_strategy", "Migration rollout strategy approval", artifact, "Run npm run db:rollout-strategy:evidence after choosing compatibility_views or controlled_window.");
  return readinessGate("rollout_strategy", "Migration rollout strategy approval", artifact, "Choose and approve APICENTER_MIGRATION_ROLLOUT_STRATEGY as compatibility_views or controlled_window before approval.");
}

function gateFromMigrationList(artifact) {
  if (!artifact.present) return missingGate("migration_history", "Linked Supabase migration history", artifact, "Run npm run db:migration-list:evidence -- --run-linked in the live operator shell.");
  return readinessGate("migration_history", "Linked Supabase migration history", artifact, "List linked migrations and compare remote history with repository migrations before approval.");
}

function gateFromSafeRollout(artifact) {
  if (!artifact.present) return missingGate("safe_rollout", "Safe registry rollout mode", artifact, "Run npm run db:safe-rollout:evidence in the live operator shell.");
  return readinessGate("safe_rollout", "Safe registry rollout mode", artifact, "Set DATABASE_ENABLED=true, DATABASE_DUAL_WRITE=true, REGISTRY_SOURCE=redis, and REGISTRY_DUAL_WRITE=true before applying DDL.");
}

function gateFromRegistryParity(artifact) {
  if (!artifact.present) return missingGate("registry_parity", "Redis/Postgres registry parity", artifact, "Run npm run db:registry-parity:evidence and npm run registry:verify before switching REGISTRY_SOURCE=postgres.");
  return readinessGate("registry_parity", "Redis/Postgres registry parity", artifact, "Run Redis/Postgres registry parity in the live operator shell before switching REGISTRY_SOURCE=postgres.");
}

function gateFromBackup(artifact) {
  if (!artifact.present) return missingGate("backup", "Live backup or schema/data dump", artifact, "Run npm run db:backup:evidence -- --run-dump after credentials are present.");
  return readinessGate("backup", "Live backup or schema/data dump", artifact, "Create the live dump and verify restore path.");
}

function gateFromDryRun(artifact) {
  if (!artifact.present) return missingGate("dry_run", "Supabase dry-run against restored/disposable database", artifact, "Run npm run db:dry-run:evidence -- --run-dry-run after backup restore.");
  return readinessGate("dry_run", "Supabase dry-run against restored/disposable database", artifact, "Run dry-run after dump/restore prerequisites are met.");
}

function gateFromAdvisors(artifact) {
  if (!artifact.present) return missingGate("advisors", "Supabase advisors reviewed", artifact, "Run npm run db:advisors:evidence -- --run-advisors in the live shell.");
  return readinessGate("advisors", "Supabase advisors reviewed", artifact, "Run advisors and review security/performance findings.");
}

function gateFromRollback(artifact) {
  if (!artifact.present) return missingGate("rollback", "Rollback config and previous image", artifact, "Run npm run db:rollback:evidence with rollback env and previous image tag.");
  return readinessGate("rollback", "Rollback config and previous image", artifact, "Capture REGISTRY_SOURCE=redis, DATABASE_DUAL_WRITE=false, and previous API Center image tag.");
}

function gateFromReadiness(artifacts) {
  if (artifacts.length === 0) return missingGate("readiness", "Old and new API Center/Management readiness", { present: false, relPath: "docs/operations/readiness-*.json" }, "Run old and new readiness evidence commands with live URLs.");
  const oldReady = artifacts.some((artifact) => artifact.data && artifact.data.phase === "old" && artifact.data.ready === true);
  const newReady = artifacts.some((artifact) => artifact.data && artifact.data.phase === "new" && artifact.data.ready === true);
  const blockers = [];
  if (!oldReady) blockers.push("Old readiness result is missing or not ready.");
  if (!newReady) blockers.push("New readiness result is missing or not ready.");
  const artifactBlockers = artifacts.flatMap((artifact) => artifact.data && Array.isArray(artifact.data.blockers) ? artifact.data.blockers : []);
  return {
    id: "readiness",
    label: "Old and new API Center/Management readiness",
    status: oldReady && newReady ? "ready" : "blocked",
    evidence: artifacts.map((artifact) => artifact.relPath).join(", "),
    detail: "Found " + artifacts.length + " readiness artifact(s); old ready=" + oldReady + "; new ready=" + newReady + ".",
    blockers: blockers.concat(artifactBlockers).filter(Boolean),
    nextAction: "Run readiness evidence twice, once with --phase old and once with --phase new, using live API Center and Management URLs.",
  };
}

function readinessGate(id, label, artifact, nextAction) {
  const blockers = artifact.data && Array.isArray(artifact.data.blockers) ? artifact.data.blockers : [];
  return {
    id,
    label,
    status: artifact.data && artifact.data.ready === true && blockers.length === 0 ? "ready" : "blocked",
    evidence: artifact.relPath,
    detail: artifact.data && artifact.data.ready === true ? "Artifact reports ready=true." : "Artifact reports ready=false or has blockers.",
    blockers,
    nextAction,
  };
}

function missingGate(id, label, artifact, nextAction) {
  return { id, label, status: "missing_evidence", evidence: artifact.relPath, detail: "Required evidence artifact is missing.", blockers: ["Evidence artifact is missing: " + artifact.relPath], nextAction };
}

function buildNextActions(gates) {
  return gates.filter((gate) => gate.status !== "ready").map((gate) => ({ gate: gate.id, action: gate.nextAction, blockers: gate.blockers }));
}

function artifactSummary(artifact) {
  return { path: artifact.relPath, present: artifact.present, ready: artifact.data && artifact.data.ready, blockers: artifact.data && artifact.data.blockers };
}

function loadReadinessArtifacts(repoRoot, primaryPath) {
  const artifacts = [];
  const primary = loadArtifact(repoRoot, primaryPath);
  if (primary.present) artifacts.push(primary);
  const operationsDir = path.join(repoRoot, "docs", "operations");
  for (const file of listJsonFiles(operationsDir)) {
    if (!/^readiness-.*\.json$/.test(path.basename(file))) continue;
    const relPath = path.relative(repoRoot, file).replace(/\\/g, "/");
    if (artifacts.some((artifact) => artifact.relPath === relPath)) continue;
    artifacts.push(loadArtifact(repoRoot, relPath));
  }
  return artifacts.filter((artifact) => artifact.present);
}

function listJsonFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function loadArtifact(repoRoot, relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const filePath = path.resolve(repoRoot, normalized);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { relPath: normalized, present: true, data: JSON.parse(raw) };
  } catch (error) {
    if (error && error.code === "ENOENT") return { relPath: normalized, present: false };
    throw error;
  }
}

function renderApprovalPacketMarkdown(packet) {
  const lines = [];
  lines.push("# APICenter Supabase Migration Approval Packet");
  lines.push("");
  lines.push("Generated: " + packet.generatedAt);
  lines.push("");
  lines.push("Approval ready: " + (packet.summary.approvalReady ? "yes" : "no"));
  lines.push("Gates ready: " + packet.summary.ready + "/" + packet.summary.total);
  lines.push("");
  lines.push("## Gate Status");
  lines.push("");
  lines.push("| Gate | Status | Evidence | Blockers | Next action |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const gate of packet.gates) {
    lines.push("| " + escapeCell(gate.label) + " | " + gate.status + " | " + escapeCell(gate.evidence) + " | " + escapeCell(gate.blockers.join("; ") || "None") + " | " + escapeCell(gate.nextAction) + " |");
  }
  lines.push("");
  lines.push("## Operator Next Actions");
  lines.push("");
  if (packet.nextActions.length === 0) lines.push("- All gates are ready for approval review.");
  else for (const action of packet.nextActions) lines.push("- " + action.gate + ": " + action.action);
  lines.push("");
  return sanitize(lines.join("\n"));
}

function escapeCell(value) {
  return sanitize(String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " "));
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function shouldFailOnBlockers(packet, argv = process.argv) {
  if (argv.includes("--fail-on-pre-apply-blockers")) {
    return !(packet.summary && packet.summary.preApplyReady === true);
  }
  return argv.includes("--fail-on-blockers") && !packet.summary.approvalReady;
}

function writeApprovalPacket(packet, jsonOut, mdOut) {
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(packet, null, 2) + "\n", "utf8");
  }
  if (mdOut) {
    fs.mkdirSync(path.dirname(mdOut), { recursive: true });
    fs.writeFileSync(mdOut, renderApprovalPacketMarkdown(packet), "utf8");
  }
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function main() {
  const packet = buildApprovalPacket();
  const jsonOut = readArg("--out") || "docs/operations/supabase-migration-approval-packet-2026-06-26.json";
  const mdOut = readArg("--md-out") || "docs/operations/supabase-migration-approval-packet-2026-06-26.md";
  writeApprovalPacket(packet, path.resolve(jsonOut), path.resolve(mdOut));
  console.log(JSON.stringify(packet.summary, null, 2));
  if (shouldFailOnBlockers(packet)) process.exitCode = 1;
}

module.exports = { buildApprovalPacket, renderApprovalPacketMarkdown, writeApprovalPacket, sanitize, shouldFailOnBlockers };

if (require.main === module) main();
