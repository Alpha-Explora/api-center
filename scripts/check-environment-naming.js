#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
// Temporary compatibility exceptions: the data pipeline stores its production
// lane as "prod", and issue #93 removes the legacy tenant OAuth setup paths.
const allowlist = [
  /(^|[/\\])data-pipeline([/\\]|$)/,
  /apps[/\\]gateway[/\\]src[/\\]shared[/\\]environment-names\.ts$/,
  /apps[/\\]management[/\\]src[/\\]lib[/\\]environment-names\.ts$/,
  /apps[/\\]management[/\\]src[/\\]app[/\\]\(management\)[/\\]shared-services[/\\]tenant-oauth([/\\]|$)/,
  /apps[/\\]management[/\\]src[/\\]app[/\\]api[/\\]local[/\\]tenant-oauth([/\\]|$)/,
  /apps[/\\]management[/\\]src[/\\]lib[/\\]tenant-oauth-lifecycle\.ts$/,
  /apps[/\\]management[/\\]src[/\\]lib[/\\]server[/\\]tenant-oauth-state-local-store\.ts$/,
  /pipeline/i,
  /athena/i,
  /confluent/i,
  /secret-manager-inventory/,
  /api-center-prod/,
  /api-shared-services-prod/,
  /supabase-live-backup/,
  /docs[/\\]superpowers[/\\]plans/,
  /docs[/\\]operations/,
  /scripts[/\\]check-environment-naming\.js$/,
];

const files = execFileSync(
  "git",
  [
    "ls-files",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.md",
    "*.json",
    "*.sql",
    "*.yaml",
    "*.yml",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean);

const violations = [];
for (const file of files) {
  if (/\.(test|spec)\.(ts|tsx|js)$/.test(file)) continue;
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  const text = fs.readFileSync(absolute, "utf8");
  if (!/\bprod\b/.test(text)) continue;
  if (allowlist.some((pattern) => pattern.test(file))) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/APICENTER_ENVIRONMENT\s*=\s*["']?prod\b/i.test(line)) {
      violations.push(`${file}:${index + 1} uses APICENTER_ENVIRONMENT=prod`);
    }
    if (
      /(?:\b[\w]*environment[\w]*\b|\bENVIRONMENTS\b)[^\r\n]*\bprod\b/i.test(
        line,
      )
    ) {
      violations.push(`${file}:${index + 1} exposes environment: "prod"`);
    }
  });
}

if (violations.length > 0) {
  console.error([...new Set(violations)].join("\n"));
  process.exit(1);
}
