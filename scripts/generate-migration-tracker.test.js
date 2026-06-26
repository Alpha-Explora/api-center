const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const planPath =
  "docs/superpowers/plans/2026-06-25-apicenter-enterprise-supabase-migration.md";
const trackerPath =
  "docs/visualizations/enterprise-supabase-migration-tracker.html";

function countCheckboxes(markdown) {
  const matches = [...markdown.matchAll(/^- \[([ xX])\]\s+/gm)];
  return {
    total: matches.length,
    done: matches.filter((match) => match[1].toLowerCase() === "x").length,
  };
}

execFileSync(process.execPath, ["scripts/generate-migration-tracker.js"], {
  stdio: "pipe",
});

const counts = countCheckboxes(fs.readFileSync(planPath, "utf8"));
const tracker = fs.readFileSync(trackerPath, "utf8");

if (counts.done < counts.total) {
  assert.equal(
    tracker.includes("<b>100%</b><span>tracked step completion</span>"),
    false,
    "tracker must not report 100% while open work remains",
  );
}

assert.match(
  tracker,
  new RegExp(`<b>${counts.done}/${counts.total}</b><span>checked items</span>`),
);

console.log("ok - tracker percentage does not round incomplete work to 100%");
