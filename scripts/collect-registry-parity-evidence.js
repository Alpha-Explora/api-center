#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const Redis = require("ioredis");

const REDIS_REGISTRY_KEY = "api-center:registry:services";
const REDIS_ENV_NAMES = ["REDIS_CACHE_URL", "REDIS_URL", "CACHE_URL"];
const MAX_DIFFS = 50;

async function collectRegistryParityEvidence({
  repoRoot = path.resolve(__dirname, ".."),
  env = process.env,
  now = new Date().toISOString(),
  redisLoader = loadRedisEntries,
  apiLoader = loadApiEntries,
  postgresLoader = loadPostgresEntries,
  fetchImpl = globalThis.fetch,
  runParity = true,
} = {}) {
  const redisUrl = firstPresent(env, REDIS_ENV_NAMES);
  const apiCenterBaseUrl = normalizeBaseUrl(firstPresent(env, ["APICENTER_URL"]));
  const platformSecret = firstPresent(env, ["API_CENTER_PLATFORM_ADMIN_SECRET", "PLATFORM_ADMIN_SECRET"]);
  const adminBearerToken = firstPresent(env, ["API_CENTER_ADMIN_BEARER_TOKEN", "APICENTER_ADMIN_BEARER_TOKEN"]);
  const environment = {
    DATABASE_URL: redactedEnvStatus(env, "DATABASE_URL"),
    REDIS_CACHE_URL: redactedEnvStatus(env, "REDIS_CACHE_URL"),
    REDIS_URL: redactedEnvStatus(env, "REDIS_URL"),
    CACHE_URL: redactedEnvStatus(env, "CACHE_URL"),
    APICENTER_URL: redactedEnvStatus(env, "APICENTER_URL"),
    API_CENTER_PLATFORM_ADMIN_SECRET: redactedEnvStatus(env, "API_CENTER_PLATFORM_ADMIN_SECRET"),
    PLATFORM_ADMIN_SECRET: redactedEnvStatus(env, "PLATFORM_ADMIN_SECRET"),
    API_CENTER_ADMIN_BEARER_TOKEN: redactedEnvStatus(env, "API_CENTER_ADMIN_BEARER_TOKEN"),
    APICENTER_ADMIN_BEARER_TOKEN: redactedEnvStatus(env, "APICENTER_ADMIN_BEARER_TOKEN"),
  };
  const blockers = [];
  if (!environment.DATABASE_URL.present) blockers.push("DATABASE_URL is not set.");
  if (!redisUrl && !(apiCenterBaseUrl && (platformSecret || adminBearerToken))) {
    blockers.push("Redis URL or API Center admin registry snapshot credentials are required for registry parity.");
  }

  let parity;
  let source;
  let redisDirectError;
  let apiSnapshot;
  if (runParity && environment.DATABASE_URL.present && redisUrl) {
    try {
      const [redisEntries, postgresEntries] = await Promise.all([
        redisLoader({ redisUrl, env }),
        postgresLoader({ databaseUrl: env.DATABASE_URL, env }),
      ]);
      parity = compareRegistryEntries(redisEntries, postgresEntries);
      source = "redis";
      if (!parity.matches) blockers.push("Redis and Postgres registry projections differ.");
    } catch (error) {
      redisDirectError = sanitize(error instanceof Error ? error.message : String(error), env);
      if (apiCenterBaseUrl && (platformSecret || adminBearerToken)) {
        try {
          const [apiEntries, postgresEntries] = await Promise.all([
            apiLoader({ apiCenterBaseUrl, platformSecret, adminBearerToken, fetchImpl, env }),
            postgresLoader({ databaseUrl: env.DATABASE_URL, env }),
          ]);
          parity = compareRegistryEntries(apiEntries, postgresEntries);
          source = "api_center_registry";
          apiSnapshot = { baseUrl: apiCenterBaseUrl, authPresent: true };
          if (!parity.matches) blockers.push("API Center registry snapshot and Postgres registry projections differ.");
        } catch (apiError) {
          blockers.push("Registry parity check failed: " + sanitize(apiError instanceof Error ? apiError.message : String(apiError), env));
        }
      } else {
        blockers.push("Registry parity check failed: " + redisDirectError);
      }
    }
  } else if (runParity && environment.DATABASE_URL.present && apiCenterBaseUrl && (platformSecret || adminBearerToken)) {
    try {
      const [apiEntries, postgresEntries] = await Promise.all([
        apiLoader({ apiCenterBaseUrl, platformSecret, adminBearerToken, fetchImpl, env }),
        postgresLoader({ databaseUrl: env.DATABASE_URL, env }),
      ]);
      parity = compareRegistryEntries(apiEntries, postgresEntries);
      source = "api_center_registry";
      apiSnapshot = { baseUrl: apiCenterBaseUrl, authPresent: true };
      if (!parity.matches) blockers.push("API Center registry snapshot and Postgres registry projections differ.");
    } catch (apiError) {
      blockers.push("Registry parity check failed: " + sanitize(apiError instanceof Error ? apiError.message : String(apiError), env));
    }
  } else if (!runParity) {
    blockers.push("Registry parity check was not run; remove --skip-run in a live operator shell.");
  }

  return {
    generatedAt: now,
    repoRoot,
    environment,
    redis: { key: REDIS_REGISTRY_KEY, urlPresent: Boolean(redisUrl), acceptedEnvNames: REDIS_ENV_NAMES, directError: redisDirectError },
    apiSnapshot,
    source,
    parity,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Set DATABASE_URL and REDIS_CACHE_URL (or REDIS_URL/CACHE_URL), or set APICENTER_URL plus API_CENTER_PLATFORM_ADMIN_SECRET/API_CENTER_ADMIN_BEARER_TOKEN.",
      "npm run registry:verify -- --out docs/operations/registry-parity-<date>.json",
      "npm run registry:verify",
      "Do not switch REGISTRY_SOURCE=postgres until the artifact reports ready=true.",
    ],
  };
}

async function loadRedisEntries({ redisUrl }) {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const raw = await redis.hgetall(REDIS_REGISTRY_KEY);
    const entries = {};
    for (const [serviceId, value] of Object.entries(raw)) entries[serviceId] = JSON.parse(value);
    return entries;
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

async function loadApiEntries({ apiCenterBaseUrl, platformSecret, adminBearerToken, fetchImpl }) {
  const headers = { Accept: "application/json" };
  if (adminBearerToken) headers.authorization = "Bearer " + adminBearerToken;
  else if (platformSecret) headers["x-platform-secret"] = platformSecret;
  const response = await fetchImpl(apiCenterBaseUrl + "/api/v1/registry/services", { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("API Center registry snapshot failed with HTTP " + response.status + ": " + text.slice(0, 200));
  }
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  return Object.fromEntries(rows.map((entry) => [entry.serviceId, entry]));
}

async function loadPostgresEntries({ databaseUrl }) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(postgresRegistrySql());
    return Object.fromEntries(result.rows.map((row) => [row.service_id, mapPostgresRow(row)]));
  } finally {
    await client.end();
  }
}

function postgresRegistrySql() {
  return [
    "select",
    "s.service_id, s.name, s.service_type, s.base_url, s.health_check_path, s.status,",
    "s.version, s.previous_version, s.description, s.tags, s.owner_tribe_id, s.owner_team, s.contact,",
    "s.service_tier, s.cost_center, s.sunset_date, s.replacement_service_id, s.healthy,",
    "s.last_health_check_at, s.registered_at, s.updated_at,",
    "coalesce((select jsonb_agg(jsonb_build_object('environment', e.environment, 'baseUrl', e.base_url, 'healthCheck', e.health_check_path, 'status', e.status, 'healthy', e.healthy, 'lastHealthCheckAt', e.last_health_check_at) order by e.environment) from apic_catalog.service_environments e where e.service_id = s.id), '[]'::jsonb) as environments,",
    "coalesce((select jsonb_agg(r.path order by r.path) from apic_catalog.service_routes r where r.service_id = s.id), '[]'::jsonb) as exposes,",
    "coalesce((select jsonb_agg(sc.scope order by sc.scope) from apic_catalog.service_scopes sc where sc.service_id = s.id), '[]'::jsonb) as required_scopes,",
    "coalesce((select jsonb_agg(coalesce(ds.service_id, d.depends_on_external_id) order by coalesce(ds.service_id, d.depends_on_external_id)) from apic_catalog.service_dependencies d left join apic_catalog.services ds on ds.id = d.depends_on_service_id where d.service_id = s.id), '[]'::jsonb) as consumes,",
    "coalesce((select jsonb_agg(jsonb_build_object('secretManagerName', sr.secret_manager_name, 'latestVersion', sr.latest_version, 'status', sr.status) order by sr.secret_manager_name) from apic_catalog.service_secret_references sr where sr.service_id = s.id), '[]'::jsonb) as secret_references",
    "from apic_catalog.services s order by s.service_id",
  ].join("\n");
}

function mapPostgresRow(row) {
  return {
    serviceId: row.service_id,
    name: row.name,
    baseUrl: row.base_url,
    requiredScopes: row.required_scopes || [],
    exposes: row.exposes || [],
    consumes: row.consumes || [],
    serviceType: row.service_type,
    healthCheck: row.health_check_path || undefined,
    version: row.version || undefined,
    previousVersion: row.previous_version || undefined,
    description: row.description || undefined,
    tags: row.tags || [],
    ownerTribeId: row.owner_tribe_id || undefined,
    ownerTeam: row.owner_team || undefined,
    contact: row.contact || undefined,
    serviceTier: row.service_tier || undefined,
    costCenter: row.cost_center || undefined,
    sunsetDate: iso(row.sunset_date),
    replacementService: row.replacement_service_id || undefined,
    registeredAt: iso(row.registered_at),
    updatedAt: iso(row.updated_at),
    status: row.status,
    healthy: row.healthy ?? undefined,
    lastHealthCheckAt: iso(row.last_health_check_at),
    environments: (row.environments || []).map((environment) => ({ environment: environment.environment, baseUrl: environment.baseUrl, healthCheck: environment.healthCheck || undefined, status: environment.status, healthy: environment.healthy ?? undefined, lastHealthCheckAt: iso(environment.lastHealthCheckAt) })),
    secretReferences: row.secret_references || [],
  };
}

function compareRegistryEntries(redisEntries, postgresEntries) {
  const redisProjection = canonicalRegistry(redisEntries);
  const postgresProjection = canonicalRegistry(postgresEntries);
  const redisIds = Object.keys(redisProjection).sort();
  const postgresIds = Object.keys(postgresProjection).sort();
  const missingInPostgres = redisIds.filter((id) => !Object.prototype.hasOwnProperty.call(postgresProjection, id));
  const missingInRedis = postgresIds.filter((id) => !Object.prototype.hasOwnProperty.call(redisProjection, id));
  const mismatches = [];
  for (const serviceId of redisIds.filter((id) => postgresIds.includes(id))) {
    if (JSON.stringify(redisProjection[serviceId]) !== JSON.stringify(postgresProjection[serviceId])) {
      mismatches.push({ serviceId, redis: redisProjection[serviceId], postgres: postgresProjection[serviceId] });
    }
  }
  return {
    matches: missingInPostgres.length === 0 && missingInRedis.length === 0 && mismatches.length === 0,
    counts: { redis: redisIds.length, postgres: postgresIds.length, missingInPostgres: missingInPostgres.length, missingInRedis: missingInRedis.length, mismatched: mismatches.length },
    missingInPostgres: missingInPostgres.slice(0, MAX_DIFFS),
    missingInRedis: missingInRedis.slice(0, MAX_DIFFS),
    mismatches: mismatches.slice(0, MAX_DIFFS),
  };
}

function canonicalRegistry(entries) {
  return Object.fromEntries(Object.entries(entries || {}).map(([serviceId, entry]) => [serviceId, canonicalEntry({ serviceId, ...entry })]));
}

function canonicalEntry(entry) {
  return dropUndefined({
    serviceId: entry.serviceId,
    name: entry.name,
    baseUrl: entry.baseUrl,
    status: entry.status,
    serviceType: entry.serviceType || "tribe",
    exposes: sorted(entry.exposes),
    requiredScopes: sorted(entry.requiredScopes),
    consumes: sorted(entry.consumes),
    ownerTribeId: entry.ownerTribeId,
    version: entry.version,
    previousVersion: entry.previousVersion,
    ownerTeam: entry.ownerTeam,
    contact: entry.contact,
    serviceTier: entry.serviceTier,
    costCenter: entry.costCenter,
    sunsetDate: iso(entry.sunsetDate),
    replacementService: entry.replacementService,
    healthCheck: entry.healthCheck,
    healthy: entry.healthy,
    environments: canonicalEnvironments(entry.environments, entry),
    secretReferences: canonicalSecretReferences(entry.secretReferences),
  });
}

function canonicalEnvironments(environments, entry) {
  const source = Array.isArray(environments) && environments.length > 0 ? environments : [{ environment: "test", baseUrl: entry.baseUrl, healthCheck: entry.healthCheck, status: entry.status, healthy: entry.healthy, lastHealthCheckAt: entry.lastHealthCheckAt }];
  return source.map((environment) => dropUndefined({ environment: environment.environment, baseUrl: environment.baseUrl, healthCheck: environment.healthCheck, status: environment.status, healthy: environment.healthy })).sort((a, b) => String(a.environment).localeCompare(String(b.environment)));
}

function canonicalSecretReferences(secretReferences) {
  return (Array.isArray(secretReferences) ? secretReferences : []).map((secret) => dropUndefined({ secretManagerName: secret.secretManagerName, latestVersion: secret.latestVersion, status: secret.status })).sort((a, b) => String(a.secretManagerName).localeCompare(String(b.secretManagerName)));
}

function sorted(value) {
  return [...new Set(Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null).map(String) : [])].sort();
}

function iso(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function firstPresent(env, names) {
  for (const name of names) if (typeof env[name] === "string" && env[name].length > 0) return env[name];
  return undefined;
}

function normalizeBaseUrl(value) {
  if (!value) return undefined;
  const trimmed = String(value).trim().replace(/\/+$/g, "");
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return { present: typeof value === "string" && value.length > 0, redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined };
}

function sanitize(value, env = process.env) {
  let text = String(value || "");
  for (const key of ["DATABASE_URL", "REDIS_CACHE_URL", "REDIS_URL", "CACHE_URL", "API_CENTER_PLATFORM_ADMIN_SECRET", "PLATFORM_ADMIN_SECRET", "API_CENTER_ADMIN_BEARER_TOKEN", "APICENTER_ADMIN_BEARER_TOKEN"]) {
    const secret = env[key];
    if (typeof secret === "string" && secret.length > 0) text = text.split(secret).join("<redacted-" + key.toLowerCase().replace(/_/g, "-") + ">");
  }
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>").replace(/redis:\/\/\S+/gi, "<redacted-redis-url>").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>").replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>").replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function writeRegistryParityEvidence(evidence, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : undefined;
}

async function main() {
  const evidence = await collectRegistryParityEvidence({ runParity: !process.argv.includes("--skip-run") });
  const outPath = readArg("--out");
  if (outPath) writeRegistryParityEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = { collectRegistryParityEvidence, compareRegistryEntries, canonicalRegistry, writeRegistryParityEvidence, sanitize };
if (require.main === module) main();
