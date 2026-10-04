#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const allowlist = [
  /(^|[/\\])data-pipeline([/\\]|$)/,
  /pipeline/i,
  /athena/i,
  /confluent/i,
  /secret-manager-inventory/,
  /api-center-prod/,
  /api-shared-services-prod/,
  /supabase-live-backup/,
  /docs[/\\]superpowers[/\\]plans/,
  /docs[/\\]operations/,
  /src[/\\]entitlements[/\\]/,
  /src[/\\]operations[/\\]service-lifecycle-evidence\.service\.spec\.ts/,
  /scripts[/\\]check-environment-naming\.js$/,
];

const files = execFileSync("git", [
  "ls-files",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.md",
  "*.json",
  "*.yaml",
  "*.yml",
], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

const violations = [];
for (const file of files) {
  if (/\.(test|spec)\.(ts|tsx|js)$/.test(file)) continue;
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  const text = fs.readFileSync(absolute, "utf8");
  if (!/prod|production/.test(text)) continue;
  if (allowlist.some((pattern) => pattern.test(file))) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/APICENTER_ENVIRONMENT\s*=\s*prod/.test(line)) {
      violations.push(`${file}:${index + 1} uses APICENTER_ENVIRONMENT=prod`);
    }
    if (/environment:\s*["']prod["']/.test(line)) {
      violations.push(`${file}:${index + 1} exposes environment: "prod"`);
    }
  });
}

if (violations.length > 0) {
  console.error([...new Set(violations)].join("\n"));
  process.exit(1);
}
