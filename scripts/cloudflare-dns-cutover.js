#!/usr/bin/env node

const API_BASE_URL = "https://api.cloudflare.com/client/v4";

function buildCutoverConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const rollback = args.has("--rollback");
  const dryRun = args.has("--dry-run");
  const force = args.has("--force");
  const zoneName = env.CLOUDFLARE_ZONE_NAME || "itsandbox.site";
  const recordName =
    env.CLOUDFLARE_RECORD_NAME || `api-center.${zoneName}`;
  const cutoverTargetIp = env.APICENTER_DNS_TARGET_IP || "136.68.196.7";
  const rollbackTargetIp = env.APICENTER_DNS_ROLLBACK_IP || "136.110.192.169";

  return {
    apiToken: env.CLOUDFLARE_API_TOKEN,
    zoneId: env.CLOUDFLARE_ZONE_ID,
    zoneName,
    recordName,
    expectedCurrentIp: rollback ? cutoverTargetIp : rollbackTargetIp,
    targetIp: rollback ? rollbackTargetIp : cutoverTargetIp,
    rollback,
    dryRun,
    force,
  };
}

async function runCloudflareDnsCutover({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  const config = buildCutoverConfig(env, argv);
  validateConfig(config, fetchImpl);

  const zoneId = config.zoneId || (await findZoneId(config, fetchImpl));
  const record = await findARecord({ ...config, zoneId }, fetchImpl);

  if (record.content === config.targetIp) {
    log(`${config.recordName} already points to ${config.targetIp}; no change needed.`);
    return {
      changed: false,
      dryRun: config.dryRun,
      beforeIp: record.content,
      afterIp: config.targetIp,
      recordId: record.id,
      zoneId,
    };
  }

  if (!config.force && record.content !== config.expectedCurrentIp) {
    throw new Error(
      `${config.recordName} expected current IP ${config.expectedCurrentIp}, got ${record.content}. Use --force only after confirming rollback state.`,
    );
  }

  if (config.dryRun) {
    log(
      `[dry-run] would update ${config.recordName} from ${record.content} to ${config.targetIp}`,
    );
    return {
      changed: false,
      dryRun: true,
      beforeIp: record.content,
      afterIp: config.targetIp,
      recordId: record.id,
      zoneId,
    };
  }

  const updated = await updateARecord({ ...config, zoneId }, record, fetchImpl);
  log(`${config.recordName} updated from ${record.content} to ${updated.content}.`);

  return {
    changed: true,
    dryRun: false,
    beforeIp: record.content,
    afterIp: updated.content,
    recordId: record.id,
    zoneId,
  };
}

function validateConfig(config, fetchImpl) {
  if (!config.apiToken) {
    throw new Error("Set CLOUDFLARE_API_TOKEN before running DNS cutover.");
  }
  if (!fetchImpl) {
    throw new Error("This script requires global fetch or an injected fetch implementation.");
  }
}

async function findZoneId(config, fetchImpl) {
  const url = `${API_BASE_URL}/zones?name=${encodeURIComponent(config.zoneName)}`;
  const data = await cloudflareRequest(fetchImpl, config.apiToken, url);
  const zone = data.result?.find((item) => item.name === config.zoneName);
  if (!zone) {
    throw new Error(`Cloudflare zone not found: ${config.zoneName}`);
  }
  return zone.id;
}

async function findARecord(config, fetchImpl) {
  const params = new URLSearchParams({
    type: "A",
    name: config.recordName,
  });
  const url = `${API_BASE_URL}/zones/${config.zoneId}/dns_records?${params}`;
  const data = await cloudflareRequest(fetchImpl, config.apiToken, url);
  const records = data.result || [];
  if (records.length !== 1) {
    throw new Error(
      `Expected exactly one Cloudflare A record for ${config.recordName}; found ${records.length}.`,
    );
  }
  return records[0];
}

async function updateARecord(config, record, fetchImpl) {
  const url = `${API_BASE_URL}/zones/${config.zoneId}/dns_records/${record.id}`;
  const data = await cloudflareRequest(fetchImpl, config.apiToken, url, {
    method: "PATCH",
    body: JSON.stringify({
      type: "A",
      name: config.recordName,
      content: config.targetIp,
      ttl: record.ttl,
      proxied: Boolean(record.proxied),
    }),
  });
  return data.result;
}

async function cloudflareRequest(fetchImpl, apiToken, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.success === false) {
    const messages = (data.errors || [])
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Cloudflare API request failed (${response.status}): ${messages || text}`,
    );
  }
  return data;
}

async function main() {
  try {
    const result = await runCloudflareDnsCutover();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Cloudflare DNS cutover failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCutoverConfig,
  runCloudflareDnsCutover,
};

if (require.main === module) main();
