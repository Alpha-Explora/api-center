#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 10000;
const API_CENTER_ENDPOINTS = [
  { name: "live", path: "/api/v1/health/live" },
  { name: "ready", path: "/api/v1/health/ready" },
];
const MANAGEMENT_ENDPOINTS = [
  { name: "home", path: "/" },
  { name: "deploymentConfig", path: "/api/local/deployment/config-check" },
];

async function collectReadinessEvidence({
  env = process.env,
  now = new Date().toISOString(),
  phase = "unlabeled",
  apiCenterBaseUrl = firstPresent(env, ["API_CENTER_BASE_URL", "APICENTER_URL"]),
  managementBaseUrl = firstPresent(env, ["MANAGEMENT_BASE_URL", "APICENTER_MANAGEMENT_URL"]),
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const blockers = [];
  const normalizedApiCenter = normalizeBaseUrl(apiCenterBaseUrl);
  const normalizedManagement = normalizeBaseUrl(managementBaseUrl);

  if (!normalizedApiCenter) blockers.push("API_CENTER_BASE_URL or APICENTER_URL is not set.");
  if (!normalizedManagement) blockers.push("MANAGEMENT_BASE_URL or APICENTER_MANAGEMENT_URL is not set.");
  if (!["old", "new", "unlabeled"].includes(phase)) {
    blockers.push("phase must be old, new, or unlabeled.");
  }

  const apiCenter = normalizedApiCenter
    ? await checkEndpointGroup({ baseUrl: normalizedApiCenter, endpoints: API_CENTER_ENDPOINTS, fetchImpl, timeoutMs })
    : { baseUrl: undefined, endpoints: [] };
  const management = normalizedManagement
    ? await checkEndpointGroup({ baseUrl: normalizedManagement, endpoints: MANAGEMENT_ENDPOINTS, fetchImpl, timeoutMs })
    : { baseUrl: undefined, endpoints: [] };

  for (const result of [...apiCenter.endpoints, ...management.endpoints]) {
    if (!result.ok) blockers.push(result.name + " readiness check failed.");
  }

  return {
    generatedAt: now,
    phase,
    expectedPhases: ["old", "new"],
    environment: {
      API_CENTER_BASE_URL: redactedEnvStatus(env, "API_CENTER_BASE_URL"),
      APICENTER_URL: redactedEnvStatus(env, "APICENTER_URL"),
      MANAGEMENT_BASE_URL: redactedEnvStatus(env, "MANAGEMENT_BASE_URL"),
      APICENTER_MANAGEMENT_URL: redactedEnvStatus(env, "APICENTER_MANAGEMENT_URL"),
    },
    apiCenter,
    management,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "npm run db:readiness:evidence -- --phase old --api-center-base-url <old-api-center-url> --management-base-url <old-management-url> --out docs/operations/readiness-old-<date>.json",
      "npm run db:readiness:evidence -- --phase new --api-center-base-url <new-api-center-url> --management-base-url <new-management-url> --out docs/operations/readiness-new-<date>.json",
      "Review API Center live/ready and Management deployment config before switching REGISTRY_SOURCE to postgres.",
    ],
  };
}

async function checkEndpointGroup({ baseUrl, endpoints, fetchImpl, timeoutMs }) {
  return {
    baseUrl,
    endpoints: await Promise.all(
      endpoints.map((endpoint) => checkEndpoint({ baseUrl, endpoint, fetchImpl, timeoutMs })),
    ),
  };
}

async function checkEndpoint({ baseUrl, endpoint, fetchImpl, timeoutMs }) {
  const url = baseUrl + endpoint.path;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json,text/plain,*/*" },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      name: endpoint.name,
      url,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      body: parseBody(text),
    };
  } catch (error) {
    return {
      name: endpoint.name,
      url,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: sanitize(String(error && error.message ? error.message : error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text) {
  if (!text) return undefined;
  const sanitized = sanitize(text);
  try {
    return JSON.parse(sanitized);
  } catch {
    return { raw: sanitized.slice(0, 1000) };
  }
}

function normalizeBaseUrl(value) {
  if (!value) return undefined;
  const trimmed = String(value).trim().replace(/\/+$/g, "");
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function firstPresent(env, names) {
  for (const name of names) {
    if (typeof env[name] === "string" && env[name].length > 0) return env[name];
  }
  return undefined;
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function writeReadinessEvidence(evidence, outPath) {
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
  const evidence = await collectReadinessEvidence({
    phase: readArg("--phase") || "unlabeled",
    apiCenterBaseUrl: readArg("--api-center-base-url") || undefined,
    managementBaseUrl: readArg("--management-base-url") || undefined,
  });
  const outPath = readArg("--out");
  if (outPath) writeReadinessEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectReadinessEvidence,
  writeReadinessEvidence,
  sanitize,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
