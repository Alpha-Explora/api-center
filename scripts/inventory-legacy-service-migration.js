#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const DEFAULT_OUT = "docs/operations/legacy-service-migration-2026-06-28.json";
const VALID_ENVIRONMENTS = new Set(["test", "live"]);
const LEGACY_SERVICE_PATTERNS = [
  { id: "api_center_test_url", pattern: /api-center-test\.itsandbox\.site/i },
  { id: "codex_temporary", pattern: /^codex-/i },
  { id: "smoke_temporary", pattern: /smoke/i },
  { id: "probe_temporary", pattern: /probe/i },
];
const REVIEW_SERVICE_PATTERNS = [
  { id: "placeholder_invalid_url", pattern: /\.invalid(?:\/|$)/i },
  { id: "local_url", pattern: /^https?:\/\/(?:localhost|127\.0\.0\.1|smoke-tribe\.local)/i },
];

async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, "..");
  const out = path.resolve(repoRoot, readArg(argv, "--out") || DEFAULT_OUT);
  const skipDb = argv.includes("--skip-db");
  const skipSecrets = argv.includes("--skip-secrets");
  const failOnLegacy = argv.includes("--fail-on-legacy");
  const env = process.env;
  const databaseUrl = env.DATABASE_URL;
  const project =
    env.GOOGLE_CLOUD_PROJECT ||
    env.GCLOUD_PROJECT ||
    env.GCP_PROJECT_ID ||
    readGcloudProject();

  const blockers = [];
  const warnings = [];
  let catalog = {
    source: skipDb ? "skipped" : "postgres",
    activeServices: [],
    summaries: {},
    error: undefined,
  };
  let secrets = {
    source: skipSecrets ? "skipped" : "gcloud_secret_manager_metadata",
    project,
    legacySecrets: [],
    scopedSecrets: [],
    summaries: {},
    previousMigrationEvidence: readPreviousSecretMigrationEvidence(repoRoot),
    error: undefined,
  };
  const codeSurface = inventoryCodeSurface(repoRoot);

  if (!skipDb && !databaseUrl) {
    blockers.push("DATABASE_URL is required unless --skip-db is used.");
    catalog = { ...catalog, source: "blocked", error: "missing_database_url" };
  } else if (!skipDb) {
    try {
      catalog = await inventoryCatalog(databaseUrl);
    } catch (error) {
      catalog = {
        ...catalog,
        source: "error",
        error: sanitizeError(error, env),
        activeServices: [],
        summaries: {},
      };
      blockers.push("Supabase/Postgres catalog inventory failed.");
    }
  }

  if (!skipSecrets && !project) {
    blockers.push("GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, GCP_PROJECT_ID, or active gcloud project is required unless --skip-secrets is used.");
    secrets = { ...secrets, source: "blocked", error: "missing_gcp_project" };
  } else if (!skipSecrets) {
    try {
      secrets = await inventorySecrets(project, repoRoot);
    } catch (error) {
      secrets = {
        ...secrets,
        project,
        source: "error",
        legacySecrets: [],
        scopedSecrets: [],
        summaries: {},
        previousMigrationEvidence: readPreviousSecretMigrationEvidence(repoRoot),
        error: sanitizeError(error, env),
      };
      blockers.push("Secret Manager metadata inventory failed.");
    }
  }

  const activeLegacyServices = catalog.activeServices.filter(
    (service) => service.legacySignals.length > 0,
  );
  const enabledLegacySecretVersions = (secrets.legacySecrets || []).reduce(
    (sum, secret) =>
      sum +
      (secret.versions || []).filter((version) => version.state === "ENABLED")
        .length,
    0,
  );
  const unmanagedLegacyCodePaths = codeSurface.findings.filter(
    (finding) => finding.requiresCleanup,
  );
  if (activeLegacyServices.length > 0) {
    warnings.push(`${activeLegacyServices.length} active service records still have legacy migration signals.`);
  }
  if (enabledLegacySecretVersions > 0) {
    warnings.push(`${secrets.legacySecrets.length} legacy Secret Manager records have ${enabledLegacySecretVersions} enabled version(s) still needing rollback disablement.`);
  } else if (secrets.legacySecrets.length > 0) {
    const cleanup = readLegacySecretCleanupEvidence(repoRoot);
    warnings.push(`${secrets.legacySecrets.length} legacy Secret Manager records are disabled for rollback and should be deleted after ${cleanup?.deleteAfter ?? "the recorded rollback window"}.`);
  }
  if (unmanagedLegacyCodePaths.length > 0) {
    warnings.push(`${unmanagedLegacyCodePaths.length} code/doc legacy compatibility findings remain.`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    mode: "apicenter-control-plane-inventory",
    payloadPolicy:
      "Secret payload values are not read or printed. Secret Manager checks use names, labels, replication metadata, and version status only.",
    environment: {
      DATABASE_URL: redactedEnvStatus(env, "DATABASE_URL"),
      GOOGLE_CLOUD_PROJECT: redactedEnvStatus(env, "GOOGLE_CLOUD_PROJECT"),
      GCLOUD_PROJECT: redactedEnvStatus(env, "GCLOUD_PROJECT"),
      GCP_PROJECT_ID: redactedEnvStatus(env, "GCP_PROJECT_ID"),
      gcloudProjectPresent: Boolean(project),
    },
    scope: {
      platformGate:
        "Migrate APICenter-owned registry/catalog/secret/code/docs state to one-URL environment-aware routing.",
      excludedGate:
        "Do not block on runtime smoke or backend access for consumer-owned services such as Spark Site, pakiapps, greenovate, shoteam, or trinithrive.",
    },
    ready:
      blockers.length === 0 &&
      activeLegacyServices.length === 0 &&
      secrets.legacySecrets.length === 0 &&
      unmanagedLegacyCodePaths.length === 0,
    blockers,
    warnings,
    catalog,
    secrets,
    codeSurface,
    nextActions: [
      "Migrate or retire every active service with legacySignals; verify using registry parity and service_environments rows.",
      "Create scoped test/live Secret Manager records only for active services that remain registered.",
      "Disable migrated legacy Secret Manager versions for a rollback window before deleting old records.",
      "Remove APICENTER_LEGACY_* and env-backed TRIBE_SECRET_* validation after stored migration has no active gaps.",
      "Replace redundant active docs/env aliases with the canonical one-URL APICenter contract.",
    ],
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      out: path.relative(repoRoot, out).replace(/\\/g, "/"),
      ready: result.ready,
      blockers: blockers.length,
      warnings: warnings.length,
      legacyServices: activeLegacyServices.length,
      legacySecrets: secrets.legacySecrets.length,
      codeFindings: unmanagedLegacyCodePaths.length,
    }),
  );

  if (failOnLegacy && !result.ready) process.exitCode = 1;
}

async function inventoryCatalog(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(catalogSql());
    const activeServices = result.rows.map(mapCatalogRow);
    return {
      source: "postgres",
      activeServices,
      summaries: summarizeCatalog(activeServices),
    };
  } finally {
    await client.end();
  }
}

function catalogSql() {
  return [
    "select",
    "s.id, s.service_id, s.name, s.owner_tribe_id, s.service_type, s.base_url, s.health_check_path, s.tags,",
    "s.status, s.updated_at, s.sunset_date, s.replacement_service_id,",
    "coalesce((select jsonb_agg(jsonb_build_object(",
    "  'environment', e.environment,",
    "  'baseUrl', e.base_url,",
    "  'healthCheck', e.health_check_path,",
    "  'status', e.status,",
    "  'updatedAt', e.updated_at",
    ") order by e.environment, e.base_url) from apic_catalog.service_environments e where e.service_id = s.id), '[]'::jsonb) as environments,",
    "coalesce((select jsonb_agg(jsonb_build_object(",
    "  'secretManagerName', sr.secret_manager_name,",
    "  'status', sr.status,",
    "  'latestVersion', sr.latest_version",
    ") order by sr.secret_manager_name) from apic_catalog.service_secret_references sr where sr.service_id = s.id), '[]'::jsonb) as secret_references,",
    "coalesce((select jsonb_agg(coalesce(ds.service_id, d.depends_on_external_id) order by coalesce(ds.service_id, d.depends_on_external_id))",
    " from apic_catalog.service_dependencies d",
    " left join apic_catalog.services ds on ds.id = d.depends_on_service_id",
    " where d.service_id = s.id), '[]'::jsonb) as consumes",
    "from apic_catalog.services s",
    "where s.status = 'active'",
    "order by s.service_type, s.service_id",
  ].join("\n");
}

function mapCatalogRow(row) {
  const environments = Array.isArray(row.environments) ? row.environments : [];
  const service = {
    serviceId: row.service_id,
    name: row.name,
    ownerTribeId: row.owner_tribe_id,
    serviceType: row.service_type,
    baseUrl: row.base_url,
    healthCheck: row.health_check_path || undefined,
    tags: normalizeTags(row.tags),
    status: row.status,
    sunsetDate: iso(row.sunset_date),
    replacementServiceId: row.replacement_service_id || undefined,
    updatedAt: iso(row.updated_at),
    environments: environments.map((environment) => ({
      environment: environment.environment,
      baseUrl: environment.baseUrl,
      healthCheck: environment.healthCheck || undefined,
      status: environment.status,
      updatedAt: iso(environment.updatedAt),
    })),
    consumes: row.consumes || [],
    secretReferences: row.secret_references || [],
  };
  const legacySignals = legacySignalsForService(service);
  return {
    ...service,
    legacySignals,
    migrationDisposition: dispositionForService(service, legacySignals),
  };
}

function legacySignalsForService(service) {
  const signals = [];
  const serviceText = `${service.serviceId}\n${service.baseUrl || ""}`;
  for (const { id, pattern } of LEGACY_SERVICE_PATTERNS) {
    if (pattern.test(serviceText)) signals.push(id);
  }
  for (const { id, pattern } of REVIEW_SERVICE_PATTERNS) {
    if (pattern.test(service.baseUrl || "")) signals.push(id);
  }
  const environments = Array.isArray(service.environments)
    ? service.environments
    : [];
  const isDocumentedTestOnly = service.tags.includes("apic:test-only");
  if (environments.length === 0) signals.push("missing_environment_rows");
  const envValues = environments.map((environment) => environment.environment);
  const invalidEnvValues = envValues.filter(
    (environment) => !VALID_ENVIRONMENTS.has(environment),
  );
  if (invalidEnvValues.length > 0) signals.push("invalid_environment_value");
  const counts = envValues.reduce((acc, environment) => {
    acc[environment] = (acc[environment] || 0) + 1;
    return acc;
  }, {});
  if (Object.values(counts).some((count) => count > 1)) {
    signals.push("duplicate_environment_rows");
  }
  if (!envValues.includes("test")) signals.push("missing_test_environment_row");
  if (
    service.serviceType === "tribe" &&
    service.status === "active" &&
    !isDocumentedTestOnly &&
    !envValues.includes("live") &&
    !signals.some((signal) => signal.includes("temporary") || signal.includes("placeholder"))
  ) {
    signals.push("missing_live_environment_row");
  }
  if (isDocumentedTestOnly) {
    removeSignal(signals, "smoke_temporary");
    removeSignal(signals, "local_url");
  }
  for (const secret of service.secretReferences || []) {
    const name = secret.secretManagerName || "";
    if (isLegacySecretName(name)) signals.push("legacy_secret_reference");
  }
  return [...new Set(signals)].sort();
}

function dispositionForService(service, legacySignals) {
  if (legacySignals.length === 0) return "new_model";
  if (
    /^(codex-|quota-smoke$|smoke-tribe$)/i.test(service.serviceId) ||
    legacySignals.some((signal) => signal.includes("temporary") || signal.includes("placeholder") || signal === "local_url")
  ) {
    return "retire_or_mark_test_only";
  }
  return "migrate_to_environment_rows";
}

function summarizeCatalog(activeServices) {
  const byDisposition = {};
  const bySignal = {};
  for (const service of activeServices) {
    byDisposition[service.migrationDisposition] =
      (byDisposition[service.migrationDisposition] || 0) + 1;
    for (const signal of service.legacySignals) {
      bySignal[signal] = (bySignal[signal] || 0) + 1;
    }
  }
  return {
    activeServiceCount: activeServices.length,
    byDisposition,
    bySignal,
  };
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map(String).sort() : [];
}

function removeSignal(signals, signal) {
  const index = signals.indexOf(signal);
  if (index >= 0) signals.splice(index, 1);
}

async function inventorySecrets(project, repoRoot) {
  const names = listSecretNames(project);
  const legacySecrets = [];
  const scopedSecrets = [];
  for (const name of names.sort()) {
    if (isLegacySecretName(name)) {
      legacySecrets.push({
        name,
        kind: name.startsWith("api-center-test-tribe-secret-")
          ? "test_prefixed"
          : "unscoped",
        targetCandidates: scopedTargetCandidates(name),
        versions: listSecretVersionStatuses(project, name),
      });
    } else if (/^api-center-tribe-secret-[a-z0-9-]+-(test|live)$/.test(name)) {
      scopedSecrets.push({
        name,
        environment: name.endsWith("-live") ? "live" : "test",
        versions: listSecretVersionStatuses(project, name),
      });
    }
  }
  return {
    source: "gcloud_secret_manager_metadata",
    project,
    legacySecrets,
    scopedSecrets,
    summaries: {
      legacySecretCount: legacySecrets.length,
      scopedSecretCount: scopedSecrets.length,
      legacyByKind: legacySecrets.reduce((acc, secret) => {
        acc[secret.kind] = (acc[secret.kind] || 0) + 1;
        return acc;
      }, {}),
    },
    previousMigrationEvidence: readPreviousSecretMigrationEvidence(repoRoot),
  };
}

function listSecretNames(project) {
  return runGcloud(["secrets", "list", `--project=${project}`, "--format=value(name)"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listSecretVersionStatuses(project, name) {
  try {
    const raw = runGcloud([
      "secrets",
      "versions",
      "list",
      name,
      `--project=${project}`,
      "--format=json(name,state,createTime,destroyTime)",
    ]).trim();
    return raw
      ? JSON.parse(raw).map((version) => ({
          version: String(version.name || "").split("/").pop(),
          state: version.state,
          createTime: version.createTime,
          destroyTime: version.destroyTime,
        }))
      : [];
  } catch {
    return [{ version: "unknown", state: "metadata_unavailable" }];
  }
}

function isLegacySecretName(name) {
  return (
    /^api-center-test-tribe-secret-/.test(name) ||
    (/^api-center-tribe-secret-[a-z0-9-]+$/.test(name) &&
      !/-(test|live)$/.test(name))
  );
}

function scopedTargetCandidates(name) {
  if (name.startsWith("api-center-test-tribe-secret-")) {
    return [
      `${name.replace("api-center-test-tribe-secret-", "api-center-tribe-secret-")}-test`,
    ];
  }
  return [`${name}-test`, `${name}-live`];
}

function inventoryCodeSurface(repoRoot) {
  const trackedFiles = listTrackedFiles(repoRoot);
  const allowed = [
    /^docs\/superpowers\/plans\//,
    /^docs\/operations\/.*(?:inventory|migration|preflight|smoke|parity).*[.](?:json|md)$/,
    /^docs\/operations\/one-url-environment-migration-inventory\.md$/,
    /^docs\/visualizations\/one-apicenter-environment-aware-routing-tracker\.html$/,
    /^scripts\/inventory-legacy-service-migration\.js$/,
    /^scripts\/verify-no-legacy-environment-routing\.js$/,
  ];
  const rules = [
    {
      id: "legacy_environment_env",
      pattern: /APICENTER_LEGACY_/g,
      description: "APICENTER_LEGACY_* compatibility env remains",
    },
    {
      id: "legacy_test_url",
      pattern: /api-center-test\.itsandbox\.site/g,
      description: "Active code/docs still reference the old test APICenter URL",
    },
    {
      id: "legacy_test_secret_name",
      pattern: /api-center-test-tribe-secret-/g,
      description: "Active code/docs still reference test-prefixed tribe secret names",
    },
    {
      id: "legacy_env_backed_secret",
      pattern: /TRIBE_SECRET_[A-Z0-9_]+/g,
      description: "Env-backed tribe secret hash support remains",
    },
    {
      id: "sdk_url_alias",
      pattern: /\bAPICENTER_(?:URL|GATEWAY_URL)\b/g,
      description: "SDK/API URL aliases still duplicate API_CENTER_BASE_URL",
    },
    {
      id: "management_environment_alias",
      pattern: /\b(?:MANAGEMENT_ENV|NEXT_PUBLIC_MANAGEMENT_ENV)\b/g,
      description: "Management deployment env aliases still duplicate MANAGEMENT_ENVIRONMENT",
    },
    {
      id: "powerbi_fallback",
      pattern: /\bPOWERBI_NORTH_STAR_/g,
      description: "Power BI fallback names still duplicate provider-neutral BI naming",
    },
  ];
  const findings = [];
  for (const file of trackedFiles) {
    if (!shouldScanFile(file)) continue;
    const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const isAllowedHistorical = allowed.some((pattern) => pattern.test(file));
    for (const rule of rules) {
      const count = countMatches(text, rule.pattern);
      if (count === 0) continue;
      findings.push({
        file,
        rule: rule.id,
        description: rule.description,
        matches: count,
        requiresCleanup: !isAllowedHistorical,
      });
    }
  }
  return {
    findings,
    summaries: {
      totalFindings: findings.length,
      cleanupFindings: findings.filter((finding) => finding.requiresCleanup)
        .length,
      byRule: findings.reduce((acc, finding) => {
        acc[finding.rule] = (acc[finding.rule] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function listTrackedFiles(repoRoot) {
  return execFileSync(
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
      ".env.example",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldScanFile(file) {
  return !(
    file.startsWith("node_modules/") ||
    file.startsWith("dist/") ||
    file.startsWith("coverage/") ||
    file.endsWith(".lock")
  );
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

function readPreviousSecretMigrationEvidence(repoRoot) {
  const evidencePath = path.join(
    repoRoot,
    "docs/operations/tribe-secret-scope-migration-2026-06-28.json",
  );
  if (!fs.existsSync(evidencePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    return {
      path: "docs/operations/tribe-secret-scope-migration-2026-06-28.json",
      generatedAt: parsed.generatedAt,
      migratedCount: Array.isArray(parsed.migrated) ? parsed.migrated.length : 0,
      notMigratedReviewCandidateCount: Array.isArray(
        parsed.notMigratedReviewCandidates,
      )
        ? parsed.notMigratedReviewCandidates.length
        : 0,
      scopedTargetsExist: parsed.verification?.scopedTargetsExist,
      removalPolicy: parsed.removalPolicy,
    };
  } catch {
    return {
      path: "docs/operations/tribe-secret-scope-migration-2026-06-28.json",
      error: "unreadable_json",
    };
  }
}

function readLegacySecretCleanupEvidence(repoRoot) {
  const evidencePath = path.join(
    repoRoot,
    "docs/operations/legacy-secret-cleanup-2026-06-28.json",
  );
  if (!fs.existsSync(evidencePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    return {
      path: "docs/operations/legacy-secret-cleanup-2026-06-28.json",
      generatedAt: parsed.generatedAt,
      deleteAfter: parsed.deleteAfter,
      scopedTargetsCreated: parsed.applied?.scopedTargetsCreated?.length ?? 0,
      legacyVersionsDisabled:
        parsed.applied?.legacyVersionsDisabled?.length ?? 0,
    };
  } catch {
    return {
      path: "docs/operations/legacy-secret-cleanup-2026-06-28.json",
      error: "unreadable_json",
    };
  }
}

function readGcloudProject() {
  try {
    const value = runGcloud(["config", "get-value", "project"]).trim();
    return value && value !== "(unset)" ? value : "";
  } catch {
    return "";
  }
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

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue:
      typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function sanitizeError(error, env) {
  let text = error instanceof Error ? error.message : String(error);
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL/i.test(key)) {
      const value = env[key];
      if (typeof value === "string" && value.length > 0) {
        text = text.split(value).join(`<redacted-${key.toLowerCase()}>`);
      }
    }
  }
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>");
}

function iso(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

module.exports = {
  legacySignalsForService,
  dispositionForService,
  scopedTargetCandidates,
  isLegacySecretName,
  inventoryCodeSurface,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeError(error, process.env));
    process.exit(1);
  });
}
