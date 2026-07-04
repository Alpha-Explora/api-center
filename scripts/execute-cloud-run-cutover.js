#!/usr/bin/env node

const childProcess = require("node:child_process");
const path = require("node:path");
const {
  runCloudflareDnsCutover: defaultRunCloudflareDnsCutover,
} = require("./cloudflare-dns-cutover");
const {
  appendRetentionEvidence,
  buildEvidenceConfig,
  collectCutoverEvidence: defaultCollectCutoverEvidence,
  defaultResolve4,
  formatRetentionRow,
} = require("./record-cloud-run-cutover-evidence");

const DEFAULT_BASE_URL = "https://api-center.itsandbox.site";
const DEFAULT_TARGET_IP = "136.68.196.7";

function buildOrchestratorConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const baseUrl = (
    env.APICENTER_CLOUD_RUN_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  return {
    baseUrl,
    host: new URL(baseUrl).hostname,
    targetIp: env.APICENTER_CUTOVER_EXPECTED_IP || DEFAULT_TARGET_IP,
    dnsTimeoutMs: Number.parseInt(env.APICENTER_CUTOVER_DNS_TIMEOUT_MS || "120000", 10),
    dnsPollMs: Number.parseInt(env.APICENTER_CUTOVER_DNS_POLL_MS || "5000", 10),
    bearerToken: env.APICENTER_CLOUD_RUN_BEARER_TOKEN,
    skipDnsCutover: args.has("--skip-dns-cutover"),
    skipTribeBoundary: args.has("--skip-tribe-boundary"),
    rollbackOnFailure: args.has("--rollback-on-failure"),
    dryRun: args.has("--dry-run"),
  };
}

async function executeCloudRunCutover({
  env = process.env,
  argv = process.argv.slice(2),
  runCloudflareDnsCutover = defaultRunCloudflareDnsCutover,
  collectCutoverEvidence = defaultCollectCutoverEvidence,
  appendEvidence = appendEvidenceToDeploymentDoc,
  runCommand = spawnCommand,
  resolve4 = defaultResolve4,
  sleep = delay,
  log = console.log,
} = {}) {
  const config = buildOrchestratorConfig(env, argv);
  validateOrchestratorConfig(config, env);

  if (!config.skipDnsCutover) {
    await runCloudflareDnsCutover({
      env,
      argv: config.dryRun ? ["--dry-run"] : [],
      log,
    });
    if (config.dryRun) {
      log("[dry-run] stopping before DNS wait, smoke, and evidence recording.");
      return {
        dnsReady: false,
        evidenceRecorded: false,
        dryRun: true,
      };
    }
  }

  const commandEnv = {
    ...env,
    APICENTER_CLOUD_RUN_BASE_URL: config.baseUrl,
    APICENTER_URL: config.baseUrl,
  };
  if (config.bearerToken) {
    commandEnv.APICENTER_CLOUD_RUN_BEARER_TOKEN = config.bearerToken;
  }

  try {
    await waitForDnsTarget({
      host: config.host,
      targetIp: config.targetIp,
      timeoutMs: config.dnsTimeoutMs,
      pollMs: config.dnsPollMs,
      resolve4,
      sleep,
      log,
    });

    await runCommand("npm", ["run", "smoke:cloud-run"], { env: commandEnv });
    if (!config.skipTribeBoundary) {
      await runCommand("npm", ["run", "smoke:tribe-boundary"], {
        env: commandEnv,
      });
    }

    const evidence = await collectCutoverEvidence({
      env: commandEnv,
      argv: [],
      resolve4,
    });
    await appendEvidence({ evidence });
  } catch (error) {
    if (config.rollbackOnFailure && !config.skipDnsCutover && !config.dryRun) {
      log(`Cutover verification failed; rolling DNS back: ${error.message}`);
      await runCloudflareDnsCutover({
        env,
        argv: ["--rollback"],
        log,
      });
    }
    throw error;
  }

  return {
    dnsReady: true,
    evidenceRecorded: true,
    dryRun: false,
  };
}

function validateOrchestratorConfig(config, env) {
  if (!config.skipDnsCutover && !env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN before executing cutover, or pass --skip-dns-cutover after DNS is already moved.",
    );
  }
  if (!config.skipDnsCutover && !env.CLOUDFLARE_ZONE_ID) {
    throw new Error(
      "Set CLOUDFLARE_ZONE_ID before executing cutover, or pass --skip-dns-cutover after DNS is already moved.",
    );
  }
  if (!config.bearerToken) {
    throw new Error("Set APICENTER_CLOUD_RUN_BEARER_TOKEN before executing cutover.");
  }
}

async function waitForDnsTarget({
  host,
  targetIp,
  timeoutMs,
  pollMs,
  resolve4 = defaultResolve4,
  sleep = delay,
  now = Date.now,
  log = console.log,
}) {
  const started = now();
  let lastIps = [];

  while (now() - started <= timeoutMs) {
    lastIps = await resolve4(host);
    if (lastIps.includes(targetIp)) {
      log(`${host} resolves to ${targetIp}.`);
      return { ips: lastIps };
    }
    log(`${host} currently resolves to ${lastIps.join(", ") || "none"}; waiting for ${targetIp}.`);
    await sleep(pollMs);
  }

  throw new Error(
    `Timed out waiting for ${host} to resolve to ${targetIp}; last IPs: ${lastIps.join(", ") || "none"}.`,
  );
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: path.resolve(__dirname, ".."),
      env: options.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function appendEvidenceToDeploymentDoc({ evidence }) {
  const fs = require("node:fs");
  const config = buildEvidenceConfig();
  const row = formatRetentionRow(evidence);
  const current = fs.existsSync(config.evidenceFile)
    ? fs.readFileSync(config.evidenceFile, "utf8")
    : "";
  const updated = appendRetentionEvidence(current, row);
  fs.writeFileSync(config.evidenceFile, updated);
  console.log(row);
  console.log(`Recorded Cloud Run retention evidence in ${config.evidenceFile}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  try {
    const result = await executeCloudRunCutover();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Cloud Run cutover orchestration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildOrchestratorConfig,
  executeCloudRunCutover,
  waitForDnsTarget,
};

if (require.main === module) main();
