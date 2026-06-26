#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_FROM = "2026-01-01";
const DEFAULT_TO = "2026-12-31";
const API_CENTER_EXPORT_PATH = "/api/v1/admin/compliance/export";
const MANAGEMENT_EXPORT_PATH = "/api/local/compliance/export";

async function collectComplianceExportEvidence({
  env = process.env,
  now = new Date().toISOString(),
  from = firstPresent(env, ["COMPLIANCE_EXPORT_FROM", "APICENTER_COMPLIANCE_EXPORT_FROM"]) || DEFAULT_FROM,
  to = firstPresent(env, ["COMPLIANCE_EXPORT_TO", "APICENTER_COMPLIANCE_EXPORT_TO"]) || DEFAULT_TO,
  apiCenterBaseUrl = firstPresent(env, ["API_CENTER_BASE_URL", "APICENTER_URL"]),
  managementBaseUrl = firstPresent(env, ["MANAGEMENT_BASE_URL", "APICENTER_MANAGEMENT_URL"]),
  platformSecret = firstPresent(env, ["API_CENTER_PLATFORM_ADMIN_SECRET", "PLATFORM_ADMIN_SECRET"]),
  adminBearerToken = firstPresent(env, ["API_CENTER_ADMIN_BEARER_TOKEN", "APICENTER_ADMIN_BEARER_TOKEN"]),
  managementBearerToken = firstPresent(env, ["MANAGEMENT_BEARER_TOKEN", "APICENTER_MANAGEMENT_BEARER_TOKEN"]),
  managementAuthMode = env.MANAGEMENT_AUTH_MODE,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const blockers = [];
  const normalizedApiCenter = normalizeBaseUrl(apiCenterBaseUrl);
  const normalizedManagement = normalizeBaseUrl(managementBaseUrl);

  if (!normalizedApiCenter && !normalizedManagement) {
    blockers.push("API_CENTER_BASE_URL/APICENTER_URL or MANAGEMENT_BASE_URL/APICENTER_MANAGEMENT_URL is required.");
  }
  if (normalizedApiCenter && !platformSecret && !adminBearerToken) {
    blockers.push("API Center compliance export requires API_CENTER_PLATFORM_ADMIN_SECRET/PLATFORM_ADMIN_SECRET or API_CENTER_ADMIN_BEARER_TOKEN.");
  }
  if (normalizedManagement && !managementBearerToken && managementAuthMode !== "local-dev") {
    blockers.push("Management compliance export smoke requires MANAGEMENT_BEARER_TOKEN or APICENTER_MANAGEMENT_BEARER_TOKEN.");
  }

  const apiCenter = normalizedApiCenter
    ? await checkComplianceExport({
        name: "api_center",
        baseUrl: normalizedApiCenter,
        pathName: API_CENTER_EXPORT_PATH,
        from,
        to,
        headers: adminHeaders({ platformSecret, adminBearerToken }),
        fetchImpl,
        timeoutMs,
      })
    : undefined;

  const management = normalizedManagement
    ? await checkComplianceExport({
        name: "management",
        baseUrl: normalizedManagement,
        pathName: MANAGEMENT_EXPORT_PATH,
        from,
        to,
        headers: managementHeaders({ managementBearerToken }),
        fetchImpl,
        timeoutMs,
      })
    : undefined;

  for (const check of [apiCenter, management].filter(Boolean)) {
    if (!check.ok) blockers.push(check.name + " compliance export smoke failed.");
    else if (!check.sourceMetadataPresent) blockers.push(check.name + " compliance export did not include source metadata.");
    else if (check.auditDurability !== "durable") {
      blockers.push(check.name + " compliance export does not prove durable audit source metadata.");
    }
  }

  return {
    generatedAt: now,
    window: { from, to },
    environment: {
      API_CENTER_BASE_URL: redactedEnvStatus(env, "API_CENTER_BASE_URL"),
      APICENTER_URL: redactedEnvStatus(env, "APICENTER_URL"),
      MANAGEMENT_BASE_URL: redactedEnvStatus(env, "MANAGEMENT_BASE_URL"),
      APICENTER_MANAGEMENT_URL: redactedEnvStatus(env, "APICENTER_MANAGEMENT_URL"),
      API_CENTER_PLATFORM_ADMIN_SECRET: redactedEnvStatus(env, "API_CENTER_PLATFORM_ADMIN_SECRET"),
      PLATFORM_ADMIN_SECRET: redactedEnvStatus(env, "PLATFORM_ADMIN_SECRET"),
      MANAGEMENT_AUTH_MODE: redactedEnvStatus(env, "MANAGEMENT_AUTH_MODE"),
      API_CENTER_ADMIN_BEARER_TOKEN: redactedEnvStatus(env, "API_CENTER_ADMIN_BEARER_TOKEN"),
      APICENTER_ADMIN_BEARER_TOKEN: redactedEnvStatus(env, "APICENTER_ADMIN_BEARER_TOKEN"),
      MANAGEMENT_BEARER_TOKEN: redactedEnvStatus(env, "MANAGEMENT_BEARER_TOKEN"),
      APICENTER_MANAGEMENT_BEARER_TOKEN: redactedEnvStatus(env, "APICENTER_MANAGEMENT_BEARER_TOKEN"),
    },
    apiCenter,
    management,
    ready: blockers.length === 0,
    blockers,
    nextCommands: [
      "Set API_CENTER_BASE_URL and API_CENTER_PLATFORM_ADMIN_SECRET, or set MANAGEMENT_BASE_URL and MANAGEMENT_BEARER_TOKEN.",
      "Run npm run db:compliance-export:evidence -- --from <yyyy-mm-dd> --to <yyyy-mm-dd> --out docs/operations/compliance-export-smoke-<date>.json.",
      "Keep compliance export smoke unchecked until this artifact is ready=true against the post-cutover endpoint.",
    ],
  };
}

async function checkComplianceExport({ name, baseUrl, pathName, from, to, headers, fetchImpl, timeoutMs }) {
  const query = new URLSearchParams({ from, to, format: "json" });
  const url = baseUrl + pathName + "?" + query.toString();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
    });
    const raw = await response.text();
    const body = parseBody(raw);
    const sourceMetadata = extractSourceMetadata(body);
    return {
      name,
      url: sanitizeUrl(url),
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      bodyShape: summarizeBody(body),
      sourceMetadataPresent: sourceMetadata.length > 0,
      auditDurability: classifyAuditDurability(sourceMetadata),
      sourceMetadata,
    };
  } catch (error) {
    return {
      name,
      url: sanitizeUrl(url),
      ok: false,
      durationMs: Date.now() - startedAt,
      error: sanitize(String(error && error.message ? error.message : error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractSourceMetadata(body) {
  const metadata = body && body.meta && Array.isArray(body.meta.sourceMetadata)
    ? body.meta.sourceMetadata
    : [];
  return metadata.map((entry) => ({
    sourceType: sanitize(entry && entry.sourceType),
    sourceName: sanitize(entry && entry.sourceName),
    durability: sanitize(entry && entry.durability),
    evidenceTable: sanitize(entry && entry.evidenceTable),
    degradedReason: sanitize(entry && entry.degradedReason),
  }));
}

function classifyAuditDurability(sourceMetadata) {
  const audit = sourceMetadata.find((entry) =>
    String(entry.sourceName || "").includes("audit") ||
    String(entry.evidenceTable || "").includes("audit_events"),
  );
  if (!audit) return "missing";
  if (audit.sourceType === "durable" || String(audit.durability || "").includes("postgres")) return "durable";
  return "volatile";
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return { type: typeof body };
  return {
    success: body.success,
    hasData: Boolean(body.data),
    summaryKeys: body.data && body.data.summary ? Object.keys(body.data.summary).sort() : [],
    metaKeys: body.meta ? Object.keys(body.meta).sort() : [],
  };
}

function adminHeaders({ platformSecret, adminBearerToken }) {
  const headers = {};
  if (platformSecret) headers["x-platform-secret"] = platformSecret;
  if (adminBearerToken) headers.authorization = "Bearer " + adminBearerToken;
  return headers;
}

function managementHeaders({ managementBearerToken }) {
  return managementBearerToken ? { authorization: "Bearer " + managementBearerToken } : {};
}

function parseBody(text) {
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
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function firstPresent(env, names) {
  for (const name of names) if (typeof env[name] === "string" && env[name].length > 0) return env[name];
  return undefined;
}

function redactedEnvStatus(env, name) {
  const value = env[name];
  return {
    present: typeof value === "string" && value.length > 0,
    redactedValue: typeof value === "string" && value.length > 0 ? "<present>" : undefined,
  };
}

function sanitizeUrl(value) {
  return sanitize(value).replace(/([?&](?:from|to|format)=)[^&]+/gi, "$1<present>");
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-postgres-url>")
    .replace(/redis:\/\/\S+/gi, "<redacted-redis-url>")
    .replace(/sbp_[A-Za-z0-9_-]+/g, "<redacted-supabase-token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/(x-platform-secret["'\s:=-]+)[A-Za-z0-9._~+\/-]+/gi, "$1<redacted>")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/(secret\s*[=:]\s*)\S+/gi, "$1<redacted>");
}

function writeComplianceExportEvidence(evidence, outPath) {
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
  const evidence = await collectComplianceExportEvidence({
    from: readArg("--from") || undefined,
    to: readArg("--to") || undefined,
    apiCenterBaseUrl: readArg("--api-center-base-url") || undefined,
    managementBaseUrl: readArg("--management-base-url") || undefined,
  });
  const outPath = readArg("--out");
  if (outPath) writeComplianceExportEvidence(evidence, path.resolve(outPath));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.blockers.length > 0 && process.argv.includes("--fail-on-blockers")) process.exitCode = 1;
}

module.exports = {
  collectComplianceExportEvidence,
  writeComplianceExportEvidence,
  sanitize,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
