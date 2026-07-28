#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const allowHistorical = [
  /^docs\/superpowers\/plans\//,
  /^docs\/operations\/.*(?:inventory|migration|cleanup|decommission|preflight|smoke|parity).*[.](?:json|md)$/,
  /^docs\/operations\/one-url-environment-migration-inventory\.md$/,
  /^scripts\/verify-no-legacy-environment-routing\.js$/,
];

const rules = [
  {
    id: "legacy_environment_env",
    pattern: /APICENTER_LEGACY_/g,
    message: "APICENTER_LEGACY_* must be removed after migration",
  },
  {
    id: "legacy_test_url",
    pattern: /api-center-test\.itsandbox\.site/g,
    message:
      "active docs/code must use the one APICenter URL plus APICENTER_ENVIRONMENT",
  },
  {
    id: "legacy_test_secret_name",
    pattern: /api-center-test-tribe-secret-/g,
    message: "test-prefixed tribe secret names are legacy",
  },
  {
    id: "legacy_env_backed_secret",
    pattern:
      /TRIBE_SECRET_(?!(?:SOURCE|GCP_PREFIX|CACHE_TTL_SECONDS|MANAGER_CLIENT)\b)[A-Z0-9_]+/g,
    message: "legacy env-backed tribe secret hashes are removed",
  },
  {
    id: "sdk_url_alias",
    pattern: /\b(?:API_CENTER_BASE_URL|APICENTER_GATEWAY_URL)\b/g,
    message: "active docs/code must use APICENTER_URL plus APICENTER_ENVIRONMENT",
  },
  {
    id: "management_environment_alias",
    pattern: /\b(?:MANAGEMENT_ENV|NEXT_PUBLIC_MANAGEMENT_ENV)\b/g,
    message: "MANAGEMENT_ENV aliases must not appear in active docs/code",
  },
  {
    id: "powerbi_fallback",
    pattern: /\bPOWERBI_NORTH_STAR_/g,
    message: "Power BI fallback env names must be isolated or removed",
  },
];

function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(__dirname, "..");
  const reportOnly = argv.includes("--report");
  const json = argv.includes("--json");
  const result = scanForLegacyRouting(repoRoot);

  if (json || reportOnly) {
    console.log(JSON.stringify({ ...result, mode: reportOnly ? "report" : "enforce" }, null, 2));
  } else if (result.violations.length > 0) {
    console.error(
      result.violations
        .map(
          (violation) =>
            `${violation.file}: ${violation.message} (${violation.matches} match${violation.matches === 1 ? "" : "es"})`,
        )
        .join("\n"),
    );
  }

  if (result.violations.length > 0 && !reportOnly) process.exitCode = 1;
}

function scanForLegacyRouting(repoRoot) {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.md",
      "*.json",
      "*.yaml",
      "*.yml",
      "*.ps1",
      ".env.example",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const violations = [];
  const historicalMatches = [];

  for (const file of files) {
    if (!shouldScanFile(file)) continue;
    const absolutePath = path.join(repoRoot, file);
    if (!fs.existsSync(absolutePath)) continue;
    const text = fs.readFileSync(absolutePath, "utf8");
    const historical = allowHistorical.some((pattern) => pattern.test(file));
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const matches = [...text.matchAll(rule.pattern)];
      if (matches.length === 0) continue;
      const entry = {
        file,
        rule: rule.id,
        message: rule.message,
        matches: matches.length,
      };
      if (historical) historicalMatches.push(entry);
      else violations.push(entry);
    }
  }

  return {
    ready: violations.length === 0,
    violations,
    historicalMatches,
  };
}

function shouldScanFile(file) {
  return !(
    file.startsWith("node_modules/") ||
    file.startsWith("dist/") ||
    file.startsWith("coverage/") ||
    file.endsWith(".lock")
  );
}

module.exports = { scanForLegacyRouting };

if (require.main === module) main();
