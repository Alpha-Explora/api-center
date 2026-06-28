#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const DEFAULT_CLEANUP = "docs/operations/legacy-secret-cleanup-2026-06-28.json";
const DEFAULT_OUT = "docs/operations/legacy-secret-cleanup-final-dry-run-2026-06-28.json";

async function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(__dirname, "..");
  const cleanupPath = path.resolve(
    repoRoot,
    readArg(argv, "--cleanup") || DEFAULT_CLEANUP,
  );
  const outPath = path.resolve(repoRoot, readArg(argv, "--out") || DEFAULT_OUT);
  const apply = argv.includes("--apply");
  const failOnBlockers = argv.includes("--fail-on-blockers");
  const confirmed = argv.includes("--confirm-delete-disabled-legacy-secrets");
  const earlyDeleteWaiver = argv.includes(
    "--confirm-early-delete-before-rollback-window",
  );
  const project =
    readArg(argv, "--project") ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    "apicenter-alpha-20260623";
  const now = new Date();
  const cleanup = JSON.parse(fs.readFileSync(cleanupPath, "utf8"));
  const candidates = collectLegacySecretCandidates(cleanup);
  const evidence = {
    generatedAt: now.toISOString(),
    mode: apply ? "apply" : "dry-run",
    project,
    payloadPolicy:
      "Secret payload values are not read or printed. This final cleanup uses only Secret Manager metadata and version states.",
    rollbackWindowPolicy: earlyDeleteWaiver
      ? "Operator explicitly waived the rollback-window wait with --confirm-early-delete-before-rollback-window. Enabled legacy versions and missing apply confirmation still block deletion."
      : "Deletion is blocked until each candidate deleteAfter timestamp unless an operator explicitly waives the rollback-window wait.",
    cleanupPath: path.relative(repoRoot, cleanupPath).replace(/\\/g, "/"),
    deleteAfter: cleanup.deleteAfter,
    summary: {
      candidates: candidates.length,
      readyToDelete: 0,
      alreadyDeleted: 0,
      blocked: 0,
      deleted: 0,
    },
    deletionPlan: [],
    applied: {
      deletedSecrets: [],
    },
    blockers: [],
    nextActions: [],
  };

  for (const candidate of candidates) {
    const inspection = inspectSecret(project, candidate.name);
    const decision = evaluateDeletionCandidate({
      candidate,
      inspection,
      now,
      fallbackDeleteAfter: cleanup.deleteAfter,
      apply,
      confirmed,
      earlyDeleteWaiver,
    });

    if (!inspection.exists) evidence.summary.alreadyDeleted += 1;
    const readyToDelete = decision.readyToDelete;
    if (readyToDelete) evidence.summary.readyToDelete += 1;
    if (decision.blockers.length > 0) {
      evidence.summary.blocked += 1;
      evidence.blockers.push(`${candidate.name}: ${decision.blockers.join("; ")}`);
    }

    evidence.deletionPlan.push({
      name: candidate.name,
      kind: candidate.kind,
      disposition: candidate.disposition,
      exists: inspection.exists,
      versionStates: summarizeVersionStates(inspection.versions),
      deleteAfter: decision.deleteAfter,
      readyToDelete,
      blockers: decision.blockers,
      waivedBlockers: decision.waivedBlockers,
    });

    if (apply && readyToDelete) {
      deleteSecret(project, candidate.name);
      evidence.applied.deletedSecrets.push(candidate.name);
      evidence.summary.deleted += 1;
    }
  }

  if (evidence.summary.blocked > 0) {
    evidence.nextActions.push(
      "Do not delete blocked legacy Secret Manager records until every blocker is cleared.",
    );
  }
  if (!apply) {
    evidence.nextActions.push(
      "After deleteAfter and after confirming no rollback is needed, rerun with --apply --confirm-delete-disabled-legacy-secrets.",
    );
    if (!earlyDeleteWaiver) {
      evidence.nextActions.push(
        "To intentionally waive the rollback wait, rerun with --confirm-early-delete-before-rollback-window; this does not bypass enabled-version checks.",
      );
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      out: path.relative(repoRoot, outPath).replace(/\\/g, "/"),
      mode: evidence.mode,
      candidates: evidence.summary.candidates,
      readyToDelete: evidence.summary.readyToDelete,
      alreadyDeleted: evidence.summary.alreadyDeleted,
      blocked: evidence.summary.blocked,
      deleted: evidence.summary.deleted,
    }),
  );

  if ((apply || failOnBlockers) && evidence.summary.blocked > 0) {
    process.exitCode = 1;
  }
}

function collectLegacySecretCandidates(cleanup) {
  const byName = new Map();
  for (const item of cleanup.legacyDisablePlan || []) {
    byName.set(item.name, {
      name: item.name,
      kind: item.kind,
      disposition: item.disposition,
      deleteAfter: item.deleteAfter || cleanup.deleteAfter,
    });
  }
  for (const item of cleanup.applied?.legacyVersionsDisabled || []) {
    if (!byName.has(item.name)) {
      byName.set(item.name, {
        name: item.name,
        kind: "unknown",
        disposition: "disabled_by_previous_cleanup",
        deleteAfter: item.deleteAfter || cleanup.deleteAfter,
      });
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function evaluateDeletionCandidate({
  candidate,
  inspection,
  now,
  fallbackDeleteAfter,
  apply = false,
  confirmed = false,
  earlyDeleteWaiver = false,
}) {
  const deleteAfter = new Date(candidate.deleteAfter || fallbackDeleteAfter);
  const deleteAfterIso = Number.isFinite(deleteAfter.getTime())
    ? deleteAfter.toISOString()
    : String(candidate.deleteAfter || fallbackDeleteAfter || "");
  const enabledVersions = inspection.versions.filter(
    (version) => version.state === "ENABLED",
  );
  const blockers = [];

  const waivedBlockers = [];

  if (Number.isFinite(deleteAfter.getTime()) && now < deleteAfter) {
    if (earlyDeleteWaiver) {
      waivedBlockers.push(`rollback window is open until ${deleteAfterIso}`);
    } else {
      blockers.push(`rollback window is open until ${deleteAfterIso}`);
    }
  }
  if (enabledVersions.length > 0) {
    blockers.push(`${enabledVersions.length} enabled version(s) still exist`);
  }
  if (apply && !confirmed) {
    blockers.push("apply mode requires --confirm-delete-disabled-legacy-secrets");
  }

  return {
    deleteAfter: deleteAfterIso,
    blockers,
    waivedBlockers,
    readyToDelete: inspection.exists && blockers.length === 0,
  };
}

function inspectSecret(project, name) {
  try {
    runGcloud(["secrets", "describe", name, `--project=${project}`, "--format=json"]);
  } catch {
    return { exists: false, versions: [] };
  }

  const raw = runGcloud([
    "secrets",
    "versions",
    "list",
    name,
    `--project=${project}`,
    "--format=json",
  ]);
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return {
    exists: true,
    versions: parsed.map((version) => ({
      version: String(version.name || "").split("/").pop(),
      state: version.state || "UNKNOWN",
    })),
  };
}

function summarizeVersionStates(versions) {
  return versions.reduce((summary, version) => {
    summary[version.state] = (summary[version.state] || 0) + 1;
    return summary;
  }, {});
}

function deleteSecret(project, name) {
  runGcloud(["secrets", "delete", name, `--project=${project}`, "--quiet"]);
}

function runGcloud(args) {
  if (process.platform === "win32") {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& gcloud ${args.map(quotePowerShellArg).join(" ")}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  }
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

module.exports = {
  collectLegacySecretCandidates,
  evaluateDeletionCandidate,
  summarizeVersionStates,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
