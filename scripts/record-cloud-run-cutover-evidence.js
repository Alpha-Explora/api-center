#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { promises: dns } = require("node:dns");

const DEFAULT_BASE_URL = "https://api-center.itsandbox.site";
const DEFAULT_EXPECTED_IP = "136.68.196.7";
const DEFAULT_EVIDENCE_FILE = path.resolve(
  __dirname,
  "..",
  "docs",
  "deployment-cloud-run.md",
);
const RETENTION_SECTION = "## Seven-Day Cloud Run Retention Evidence";
const RETENTION_TABLE_HEADER =
  "| Date | Health | Payment live | Redis | Error notes | Decision |\n| --- | --- | --- | --- | --- | --- |";

function buildEvidenceConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const baseUrl = (
    env.APICENTER_CLOUD_RUN_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const host = new URL(baseUrl).hostname;

  return {
    baseUrl,
    host,
    expectedIp: env.APICENTER_CUTOVER_EXPECTED_IP || DEFAULT_EXPECTED_IP,
    bearerToken: env.APICENTER_CLOUD_RUN_BEARER_TOKEN,
    evidenceFile: env.APICENTER_CUTOVER_EVIDENCE_FILE || DEFAULT_EVIDENCE_FILE,
    skipPayment: args.has("--skip-payment"),
    dryRun: args.has("--dry-run"),
  };
}

async function collectCutoverEvidence({
  env = process.env,
  argv = process.argv.slice(2),
  resolve4 = defaultResolve4,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  measure = timed,
} = {}) {
  const config = buildEvidenceConfig(env, argv);
  if (!fetchImpl) {
    throw new Error("This script requires global fetch or an injected fetch implementation.");
  }
  if (!config.skipPayment && !config.bearerToken) {
    throw new Error(
      "Set APICENTER_CLOUD_RUN_BEARER_TOKEN before recording payment-live cutover evidence, or pass --skip-payment.",
    );
  }

  const ips = await resolve4(config.host);
  if (!ips.includes(config.expectedIp)) {
    throw new Error(
      `${config.host} DNS does not include expected Cloud Run IP ${config.expectedIp}; got ${ips.join(", ") || "none"}.`,
    );
  }

  const live = await measure(() => requestJson(fetchImpl, config, "/api/v1/health/live"));
  const ready = await measure(() => requestJson(fetchImpl, config, "/api/v1/health/ready"));
  const redis = extractRedisStatus(ready.value.body);
  let paymentLive = "skipped";

  if (!config.skipPayment) {
    const payment = await measure(() =>
      requestJson(fetchImpl, config, "/api/v1/shared/payment/health", {
        Authorization: `Bearer ${config.bearerToken}`,
      }),
    );
    paymentLive = `pass: ${payment.value.status} ${payment.ms}ms`;
  }

  return {
    date: now().toISOString().slice(0, 10),
    dns: `pass: ${ips.join(", ")}`,
    health: `pass: live ${live.value.status} ${live.ms}ms, ready ${ready.value.status} ${ready.ms}ms`,
    paymentLive,
    redis,
    errorNotes: "none",
    decision: "keep Cloud Run",
  };
}

async function defaultResolve4(host, lookup = dns.lookup) {
  const results = await lookup(host, { family: 4, all: true });
  return results
    .filter((result) => result.family === 4)
    .map((result) => result.address);
}

async function requestJson(fetchImpl, config, requestPath, headers = {}) {
  const response = await fetchImpl(`${config.baseUrl}${requestPath}`, {
    headers,
  });
  const text = await response.text();
  const body = parseJson(text);
  if (!response.ok) {
    throw new Error(
      `${requestPath} returned ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return { status: response.status, body };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function extractRedisStatus(readyBody) {
  return (
    readyBody?.details?.redis?.status ||
    readyBody?.info?.redis?.status ||
    "unknown"
  );
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { ms: Date.now() - started, value };
}

function formatRetentionRow(evidence) {
  return [
    evidence.date,
    evidence.health,
    evidence.paymentLive,
    evidence.redis,
    evidence.errorNotes,
    evidence.decision,
  ]
    .map(escapeTableCell)
    .join(" | ")
    .replace(/^/, "| ")
    .replace(/$/, " |");
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function appendRetentionEvidence(markdown, row) {
  if (!markdown.includes(RETENTION_SECTION)) {
    return `${markdown.trimEnd()}\n\n${RETENTION_SECTION}\n\n${RETENTION_TABLE_HEADER}\n${row}\n`;
  }

  if (markdown.includes(row)) {
    return markdown;
  }

  const sectionIndex = markdown.indexOf(RETENTION_SECTION);
  const nextSectionIndex = markdown.indexOf("\n## ", sectionIndex + 1);
  const insertIndex = nextSectionIndex === -1 ? markdown.length : nextSectionIndex;
  const before = markdown.slice(0, insertIndex).trimEnd();
  const after = markdown.slice(insertIndex);
  return `${before}\n${row}\n${after}`;
}

async function main() {
  try {
    const config = buildEvidenceConfig();
    const evidence = await collectCutoverEvidence();
    const row = formatRetentionRow(evidence);
    if (config.dryRun) {
      console.log(row);
      return;
    }

    const current = fs.existsSync(config.evidenceFile)
      ? fs.readFileSync(config.evidenceFile, "utf8")
      : "";
    const updated = appendRetentionEvidence(current, row);
    fs.writeFileSync(config.evidenceFile, updated);
    console.log(row);
    console.log(`Recorded Cloud Run retention evidence in ${config.evidenceFile}`);
  } catch (error) {
    console.error(`Cloud Run cutover evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  appendRetentionEvidence,
  buildEvidenceConfig,
  collectCutoverEvidence,
  defaultResolve4,
  formatRetentionRow,
};

if (require.main === module) main();
