#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PLAN = "docs/superpowers/plans/2026-06-25-apicenter-enterprise-supabase-migration.md";
const DEFAULT_TRACKER = "docs/visualizations/enterprise-supabase-migration-tracker.html";
const DEFAULT_PACKET = "docs/operations/supabase-migration-approval-packet-2026-06-26.json";

function collectMigrationTrackingConsistency({ repoRoot = path.resolve(__dirname, ".."), planPath = DEFAULT_PLAN, trackerPath = DEFAULT_TRACKER, packetPath = DEFAULT_PACKET, now = new Date().toISOString() } = {}) {
  const planRel = normalizeRel(planPath);
  const trackerRel = normalizeRel(trackerPath);
  const packetRel = normalizeRel(packetPath);
  const plan = readText(repoRoot, planRel);
  const tracker = readText(repoRoot, trackerRel);
  const packet = readJson(repoRoot, packetRel);
  const planCounts = countTrackedPlanItems(plan.content || "");
  const trackerCounts = parseTrackerCounts(tracker.content || "");
  const packetSummary = packet.data && packet.data.summary ? packet.data.summary : null;
  const gateReferences = parseGateReferences(plan.content || "");
  const blockers = [];

  if (!plan.present) blockers.push("Plan Markdown is missing: " + planRel);
  if (!tracker.present) blockers.push("Tracker HTML is missing: " + trackerRel);
  if (!packet.present) blockers.push("Approval packet JSON is missing: " + packetRel);

  if (packet.present && !packetSummary) blockers.push("Approval packet summary is missing.");
  if (packetSummary) {
    for (const reference of gateReferences) {
      if (reference.ready !== packetSummary.ready || reference.total !== packetSummary.total) {
        blockers.push("Plan gate-count note at line " + reference.line + " says " + reference.ready + " of " + reference.total + ", but approval packet says " + packetSummary.ready + " of " + packetSummary.total + ".");
      }
    }
  }

  if (tracker.present && !trackerCounts) blockers.push("Tracker checked-item metric could not be parsed.");
  if (trackerCounts) {
    if (trackerCounts.done !== planCounts.done || trackerCounts.total !== planCounts.total) {
      blockers.push("Tracker checkbox metric says " + trackerCounts.done + "/" + trackerCounts.total + ", but plan has " + planCounts.done + "/" + planCounts.total + ".");
    }
    if (trackerCounts.percent !== planCounts.percent) {
      blockers.push("Tracker percent says " + trackerCounts.percent + "%, but plan computes " + planCounts.percent + "%.");
    }
  }

  return {
    generatedAt: now,
    repoRoot,
    artifacts: {
      plan: { path: planRel, present: plan.present },
      tracker: { path: trackerRel, present: tracker.present },
      approvalPacket: { path: packetRel, present: packet.present },
    },
    planCounts,
    trackerCounts,
    packetSummary,
    gateReferences,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Fix stale gate-count notes in the migration plan.",
      "Run node scripts/generate-migration-tracker.js after plan checkbox changes.",
      "Run npm run db:tracking:consistency after regenerating approval packet or tracker artifacts.",
    ],
  };
}

function countTrackedPlanItems(markdown) {
  const lines = markdown.split(/\r?\n/);
  const trackedHeadings = new Set(["Progress Tracking Artifacts", "Pre-Live-Migration Requirements", "Final Verification Checklist"]);
  let inTrackedSection = false;
  let total = 0;
  let done = 0;
  for (const line of lines) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      const title = heading[1].trim();
      inTrackedSection = trackedHeadings.has(title) || title.startsWith("Task ");
      continue;
    }
    if (!inTrackedSection) continue;
    const checkbox = line.match(/^- \[([ xX])\]\s+/);
    if (!checkbox) continue;
    total += 1;
    if (checkbox[1].toLowerCase() === "x") done += 1;
  }
  return { done, total, percent: formatPercent(done, total) };
}

function formatPercent(doneCount, totalCount) {
  if (!totalCount) return "0";
  if (doneCount === totalCount) return "100";
  const raw = (doneCount / totalCount) * 100;
  return Math.min(99.9, Number(raw.toFixed(1))).toString();
}

function parseGateReferences(markdown) {
  const references = [];
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const regex = /(\d+)\s+of\s+(\d+)\s+(?:live\s+)?(?:approval\s+)?gates ready/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      references.push({ line: index + 1, ready: Number(match[1]), total: Number(match[2]) });
    }
  }
  return references;
}

function parseTrackerCounts(html) {
  const checked = html.match(/<b>(\d+)\/(\d+)<\/b><span>checked items<\/span>/);
  const percent = html.match(/<b>(\d+(?:\.\d+)?)%<\/b><span>tracked step completion<\/span>/);
  if (!checked || !percent) return null;
  return { done: Number(checked[1]), total: Number(checked[2]), percent: percent[1] };
}

function readText(repoRoot, relPath) {
  try {
    return { present: true, content: fs.readFileSync(path.join(repoRoot, relPath), "utf8") };
  } catch (error) {
    if (error && error.code === "ENOENT") return { present: false };
    throw error;
  }
}

function readJson(repoRoot, relPath) {
  const result = readText(repoRoot, relPath);
  if (!result.present) return { present: false };
  return { present: true, data: JSON.parse(result.content) };
}

function normalizeRel(value) {
  return value.replace(/\\/g, "/");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = argv[++index];
    else if (arg === "--plan") options.planPath = argv[++index];
    else if (arg === "--tracker") options.trackerPath = argv[++index];
    else if (arg === "--packet") options.packetPath = argv[++index];
    else if (arg === "--fail-on-blockers") options.failOnBlockers = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const evidence = collectMigrationTrackingConsistency({ repoRoot, planPath: options.planPath || DEFAULT_PLAN, trackerPath: options.trackerPath || DEFAULT_TRACKER, packetPath: options.packetPath || DEFAULT_PACKET });
  if (options.out) {
    const outPath = path.resolve(repoRoot, options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  if (options.failOnBlockers && !evidence.ready) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { collectMigrationTrackingConsistency, countTrackedPlanItems, parseGateReferences, parseTrackerCounts, formatPercent };
