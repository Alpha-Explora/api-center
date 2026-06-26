const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectMigrationTrackingConsistency, countTrackedPlanItems, parseGateReferences, parseTrackerCounts, formatPercent } = require("./check-migration-tracking-consistency.js");

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-tracking-consistency-"));
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

const plan = [
  "## Progress Tracking Artifacts",
  "- [x] Created tracker.",
  "- [ ] Keep tracker aligned.",
  "## Pre-Live-Migration Requirements",
  "Approval packet currently reports 0 of 13 live approval gates ready.",
  "- [ ] Confirm target project.",
  "## Task 1: Example",
  "- [x] **Step 1: Done**",
  "- [ ] **Step 2: Open**",
  "## Final Verification Checklist",
  "- [x] Focused tests pass.",
].join("\n");

run("counts tracked plan checkboxes", () => {
  assert.deepEqual(countTrackedPlanItems(plan), { done: 3, total: 6, percent: "50" });
});

run("parses gate references", () => {
  assert.deepEqual(parseGateReferences(plan), [{ line: 5, ready: 0, total: 13 }]);
});

run("parses tracker counts", () => {
  assert.deepEqual(parseTrackerCounts('<b>50%</b><span>tracked step completion</span><b>3/6</b><span>checked items</span>'), { done: 3, total: 6, percent: "50" });
});

run("does not format incomplete work as 100 percent", () => {
  assert.equal(formatPercent(240, 241), "99.6");
  assert.equal(formatPercent(241, 241), "100");
});

run("passes when plan, tracker, and approval packet agree", () => {
  withTempRepo({
    "plan.md": plan,
    "tracker.html": '<b>50%</b><span>tracked step completion</span><b>3/6</b><span>checked items</span>',
    "packet.json": { summary: { ready: 0, total: 13, blocked: 13, approvalReady: false } },
  }, (repoRoot) => {
    const evidence = collectMigrationTrackingConsistency({ repoRoot, planPath: "plan.md", trackerPath: "tracker.html", packetPath: "packet.json", now: "2026-06-26T00:00:00.000Z" });
    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
  });
});

run("blocks stale gate counts and tracker metrics", () => {
  withTempRepo({
    "plan.md": plan.replace("0 of 13", "0 of 12"),
    "tracker.html": '<b>49%</b><span>tracked step completion</span><b>2/6</b><span>checked items</span>',
    "packet.json": { summary: { ready: 0, total: 13, blocked: 13, approvalReady: false } },
  }, (repoRoot) => {
    const evidence = collectMigrationTrackingConsistency({ repoRoot, planPath: "plan.md", trackerPath: "tracker.html", packetPath: "packet.json" });
    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("0 of 12")), true);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("2/6")), true);
    assert.equal(evidence.blockers.some((blocker) => blocker.includes("49%")), true);
  });
});
