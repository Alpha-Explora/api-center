#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const options = {
  envFile: getArg("--env-file", "..\\apicenter-management\\.env.live"),
  gcpProject: getArg("--gcp-project", "api-center-496422"),
  apiCenterSecretName: getArg("--api-center-secret-name", "api-center-prod"),
  tribeId: getArg("--tribe-id", "logistics"),
  sourceServiceId: getArg("--source-service-id", "logistics-orders"),
  topicName: getArg("--topic-name", "prod.tribe.logistics.events"),
  eventType: getArg("--event-type", "order.created"),
  schemaVersion: getArg("--schema-version", "1.0.0"),
  count: Number.parseInt(getArg("--count", "1"), 10),
  plaintextTribeSecret: getArg("--plaintext-tribe-secret", ""),
  rotateSmokeSecret: args.has("--rotate-smoke-secret"),
  dryRun: args.has("--dry-run"),
};
if (!Number.isInteger(options.count) || options.count < 1 || options.count > 1000) {
  throw new Error("--count must be an integer from 1 to 1000.");
}
const GCLOUD_BIN = process.platform === "win32" ? "gcloud.cmd" : "gcloud";

function runCommand(command, args, options) {
  if (process.platform !== "win32") {
    return execFileSync(command, args, options);
  }

  return execFileSync("cmd.exe", ["/d", "/s", "/c", command, ...args], options);
}

function importDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue;
    const [key, ...rest] = line.split("=");
    process.env[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

function gcloudJson(gcloudArgs) {
  return JSON.parse(
    runCommand(GCLOUD_BIN, gcloudArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function gcloudText(gcloudArgs) {
  return runCommand(GCLOUD_BIN, gcloudArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gcloudInherits(gcloudArgs) {
  runCommand(GCLOUD_BIN, gcloudArgs, { stdio: "ignore" });
}

function smokeSecret() {
  return crypto
    .randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${init.method ?? "GET"} ${url} failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  importDotEnv(options.envFile);
  const baseUrl = (process.env.API_CENTER_BASE_URL || process.env.APICENTER_URL || "").replace(/\/+$/g, "");
  if (!baseUrl) {
    throw new Error("API_CENTER_BASE_URL or APICENTER_URL is required.");
  }

  const secretPrefix = process.env.TRIBE_SECRET_GCP_PREFIX || "api-center-tribe-secret-";
  const tribeSecretName = `${secretPrefix}${options.tribeId}`;
  const smokeId = `prod-logistics-smoke-${new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14)}`;

  const apiCenterPayload = gcloudJson([
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret",
    options.apiCenterSecretName,
    "--project",
    options.gcpProject,
  ]);
  const platformAdminSecret = apiCenterPayload.PLATFORM_ADMIN_SECRET;
  if (!platformAdminSecret) {
    throw new Error(`PLATFORM_ADMIN_SECRET is missing from ${options.apiCenterSecretName}.`);
  }

  let secretExists = true;
  try {
    gcloudText([
      "secrets",
      "describe",
      tribeSecretName,
      "--project",
      options.gcpProject,
      "--format",
      "json",
    ]);
  } catch {
    secretExists = false;
  }

  let plaintextTribeSecret = options.plaintextTribeSecret;
  let generatedSmokeSecret = false;
  if (!plaintextTribeSecret) {
    if (secretExists && !options.rotateSmokeSecret) {
      throw new Error(`${tribeSecretName} already exists. Pass --plaintext-tribe-secret or --rotate-smoke-secret.`);
    }
    plaintextTribeSecret = smokeSecret();
    generatedSmokeSecret = true;
  }

  let secretCreated = false;
  let secretVersionAdded = false;
  if ((!secretExists || options.rotateSmokeSecret) && !options.dryRun) {
    const hash = crypto.createHash("sha256").update(plaintextTribeSecret).digest("hex");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apic-logistics-smoke-"));
    const tmpFile = path.join(tmpDir, "secret.json");
    try {
      fs.writeFileSync(
        tmpFile,
        JSON.stringify(
          {
            serviceId: options.tribeId,
            status: "active",
            secretHashSha256: hash,
            createdAt: new Date().toISOString(),
            createdBy: "codex-prod-logistics-smoke",
            purpose: "prod logistics data-pipeline smoke",
          },
          null,
          2,
        ),
      );
      if (secretExists) {
        gcloudInherits([
          "secrets",
          "versions",
          "add",
          tribeSecretName,
          "--project",
          options.gcpProject,
          "--data-file",
          tmpFile,
        ]);
        secretVersionAdded = true;
      } else {
        gcloudInherits([
          "secrets",
          "create",
          tribeSecretName,
          "--project",
          options.gcpProject,
          "--replication-policy",
          "automatic",
          "--data-file",
          tmpFile,
        ]);
        secretCreated = true;
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          base_url: baseUrl,
          tribe_secret_name: tribeSecretName,
          tribe_secret_exists: secretExists,
          would_generate_smoke_secret: generatedSmokeSecret,
          would_register: [options.tribeId, options.sourceServiceId],
          would_publish_topic: options.topicName,
          event_type: options.eventType,
          schema_version: options.schemaVersion,
          count: options.count,
        },
        null,
        2,
      ),
    );
    return;
  }

  const adminHeaders = { "X-Platform-Secret": platformAdminSecret };
  await jsonRequest(`${baseUrl}/api/v1/registry/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      serviceId: options.tribeId,
      ownerTribeId: options.tribeId,
      name: "Logistics Tribe",
      baseUrl: "https://logistics.example.invalid",
      requiredScopes: ["logistics:read"],
      exposes: ["/health"],
      consumes: ["kafka"],
      serviceType: "tribe",
      version: "1.0.0",
      ownerTeam: "logistics-platform",
      contact: "logistics-platform@example.invalid",
    }),
  });
  await jsonRequest(`${baseUrl}/api/v1/registry/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      serviceId: options.sourceServiceId,
      ownerTribeId: options.tribeId,
      name: "Logistics Orders",
      baseUrl: "https://logistics-orders.example.invalid",
      requiredScopes: ["orders:read"],
      exposes: ["/orders", "/health"],
      consumes: [],
      serviceType: "tribe",
      version: "1.0.0",
      ownerTeam: "logistics-platform",
      contact: "logistics-platform@example.invalid",
    }),
  });

  let tokenResponse;
  const tokenAttempts = options.rotateSmokeSecret ? 12 : 1;
  for (let attempt = 1; attempt <= tokenAttempts; attempt += 1) {
    try {
      tokenResponse = await jsonRequest(`${baseUrl}/api/v1/auth/token`, {
        method: "POST",
        body: JSON.stringify({
          tribeId: options.tribeId,
          secret: plaintextTribeSecret,
        }),
      });
      break;
    } catch (error) {
      if (
        attempt >= tokenAttempts ||
        !String(error.message).includes('"code":"UNAUTHORIZED"')
      ) {
        throw error;
      }
      await sleep(30_000);
    }
  }
  const accessToken = tokenResponse.data?.accessToken;
  if (!accessToken) {
    throw new Error("Token response did not include data.accessToken.");
  }

  let publishResponse;
  for (let index = 0; index < options.count; index += 1) {
    const eventId =
      options.count === 1 ? smokeId : `${smokeId}-${String(index + 1).padStart(4, "0")}`;
    publishResponse = await jsonRequest(`${baseUrl}/api/v1/kafka/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        topic: options.topicName,
        key: eventId,
        eventType: options.eventType,
        schemaVersion: options.schemaVersion,
        sourceServiceId: options.sourceServiceId,
        payload: {
          orderId: eventId,
          smokeId,
          smokeSequence: index + 1,
          ownerTribeId: options.tribeId,
          sourceServiceId: options.sourceServiceId,
          occurredAt: new Date().toISOString(),
        },
      }),
    });
  }

  console.log(
    JSON.stringify(
      {
        dry_run: false,
        smoke_id: smokeId,
        base_url: baseUrl,
        tribe_secret_name: tribeSecretName,
        tribe_secret_created: secretCreated,
        tribe_secret_version_added: secretVersionAdded,
        generated_smoke_secret: generatedSmokeSecret,
        registered_services: [options.tribeId, options.sourceServiceId],
        publish_count: options.count,
        topic: publishResponse.data?.topic,
        event_type: publishResponse.data?.eventType,
        accepted: publishResponse.data?.accepted,
        schema_validation_status: publishResponse.data?.schemaValidationStatus,
        schema_registry_version: publishResponse.data?.schemaRegistryVersion,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
