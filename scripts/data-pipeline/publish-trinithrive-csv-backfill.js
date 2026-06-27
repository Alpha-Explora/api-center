#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_FILES = [
  "organizations_rows.csv",
  "volunteer_applications_rows.csv",
  "volunteer_deployments_rows.csv",
  "volunteer_roles_rows.csv",
  "volunteer_shifts_rows_1.csv",
  "bh_campaigns_rows.csv",
  "bh_user_profiles_rows.csv",
  "donations_rows.csv",
  "evacuees_rows.csv",
  "incident_reports_rows.csv",
  "relief_items_rows.csv",
  "relief_operations_rows.csv",
  "user_profiles_rows.csv",
  "disaster_events_rows.csv",
  "dispatch_orders_rows.csv",
  "distribution_items_rows.csv",
  "distributions_rows.csv",
  "evacuation_centers_rows.csv",
];

const SENSITIVE_FIELDS = new Set([
  "address",
  "assigned_to",
  "attachment_keys",
  "auth_user_id",
  "availability",
  "contact",
  "contact_email",
  "contact_phone",
  "content",
  "created_by",
  "distributed_by",
  "donor_auth_id",
  "email",
  "family_head",
  "first_name",
  "hopecard_id",
  "instructions",
  "last_name",
  "lead_officer",
  "message",
  "motivation",
  "phone",
  "reported_by",
  "resume_key",
  "special_needs",
  "volunteer_auth_id",
]);

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    ),
  );
}

function coerceValue(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+$/.test(trimmed) && trimmed.length < 16) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed) && trimmed.length < 16) return Number(trimmed);
  return trimmed;
}

function sanitizeRow(row) {
  const payload = {};
  const redactedFields = [];

  for (const [field, rawValue] of Object.entries(row)) {
    const normalized = field.trim().toLowerCase();
    if (SENSITIVE_FIELDS.has(normalized)) {
      if (String(rawValue ?? "").trim() !== "") redactedFields.push(field);
      continue;
    }

    payload[field] = coerceValue(rawValue);
  }

  return { payload, redactedFields };
}

function sourceTableFromFile(fileName) {
  return path
    .basename(fileName, ".csv")
    .replace(/_rows(?:_\d+)?$/u, "");
}

function buildEventType(fileName) {
  return `trinithrive.${sourceTableFromFile(fileName)}.snapshot`;
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

function runCommand(command, commandArgs, options) {
  if (process.platform !== "win32") {
    return execFileSync(command, commandArgs, options);
  }

  return execFileSync("cmd.exe", ["/d", "/s", "/c", command, ...commandArgs], options);
}

function gcloudInherits(gcloudArgs) {
  const bin = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  runCommand(bin, gcloudArgs, { stdio: "ignore" });
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

function isUnauthorizedError(error) {
  return (
    String(error?.message ?? "").includes(" 401:") ||
    String(error?.message ?? "").includes('"code":"UNAUTHORIZED"')
  );
}

function isTransientPublishError(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes(" 429:") ||
    message.includes(" 500:") ||
    message.includes(" 502:") ||
    message.includes(" 503:") ||
    message.includes(" 504:")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken({
  attempts,
  baseUrl,
  environment,
  plaintextTribeSecret,
  tribeId,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const tokenResponse = await jsonRequest(`${baseUrl}/api/v1/auth/token`, {
        method: "POST",
        body: JSON.stringify({
          tribeId,
          secret: plaintextTribeSecret,
          environment,
        }),
      });
      const accessToken = tokenResponse.data?.accessToken;
      if (!accessToken) {
        throw new Error("Token response did not include data.accessToken.");
      }
      return accessToken;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isUnauthorizedError(error)) break;
      await sleep(30_000);
    }
  }

  throw lastError;
}

function smokeSecret() {
  return crypto
    .randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function writeTribeSecretVersion({
  gcpProject,
  environment,
  plaintextTribeSecret,
  tribeId,
  tribeSecretName,
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apic-trinithrive-backfill-"));
  const tmpFile = path.join(tmpDir, "secret.json");
  try {
    const hash = crypto
      .createHash("sha256")
      .update(plaintextTribeSecret)
      .digest("hex");
    fs.writeFileSync(
      tmpFile,
      JSON.stringify(
        {
          tribeId,
          environment,
          status: "active",
          secretHashSha256: hash,
          createdAt: new Date().toISOString(),
          createdBy: "codex-trinithrive-csv-backfill",
          purpose: "test TriniThrive governed CSV backfill",
        },
        null,
        2,
      ),
    );
    gcloudInherits([
      "secrets",
      "versions",
      "add",
      tribeSecretName,
      "--project",
      gcpProject,
      "--data-file",
      tmpFile,
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildEvents({ csvDir, files, limit, sourceServiceId, topicName }) {
  const events = [];
  const summaries = [];

  for (const fileName of files) {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(csvDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath}`);
    }

    const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
    const sourceTable = sourceTableFromFile(fileName);
    const eventType = buildEventType(fileName);
    let redactedFieldCount = 0;

    rows.forEach((row, index) => {
      if (limit && events.length >= limit) return;
      const sanitized = sanitizeRow(row);
      redactedFieldCount += sanitized.redactedFields.length;
      const stableId = row.id || `${sourceTable}-${index + 1}`;
      events.push({
        topic: topicName,
        key: `${sourceTable}:${stableId}`,
        eventType,
        schemaVersion: "1.0.0",
        sourceServiceId,
        metadata: {
          sourceTable,
          sourceFile: path.basename(fileName),
          backfillKind: "sanitized-csv-snapshot",
        },
        payload: {
          ...sanitized.payload,
          backfill: {
            sourceTable,
            sourceFile: path.basename(fileName),
            rowNumber: index + 1,
            redactedFieldCount: sanitized.redactedFields.length,
            redactedFields: sanitized.redactedFields,
          },
        },
      });
    });

    summaries.push({
      file: path.basename(fileName),
      rows: rows.length,
      eventType,
      redactedFieldCount,
    });
  }

  return { events, summaries };
}

function filterEventsByKeys(events, keys) {
  if (!keys || keys.size === 0) return events;
  return events.filter((event) => keys.has(event.key));
}

async function registerTribe({ baseUrl, platformAdminSecret, tribeId, sourceServiceId }) {
  const adminHeaders = { "X-Platform-Secret": platformAdminSecret };
  await jsonRequest(`${baseUrl}/api/v1/registry/register`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      serviceId: tribeId,
      ownerTribeId: tribeId,
      name: "TriniThrive",
      baseUrl: "https://trinithrive.example.invalid",
      requiredScopes: ["trinithrive:read"],
      exposes: ["/health"],
      consumes: ["kafka"],
      serviceType: "tribe",
      version: "1.0.0",
      ownerTeam: "trinithrive",
      contact: "ops@trinithrive.example.invalid",
    }),
  });

  if (sourceServiceId !== tribeId) {
    await jsonRequest(`${baseUrl}/api/v1/registry/register`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        serviceId: sourceServiceId,
        ownerTribeId: tribeId,
        name: "TriniThrive Backfill Publisher",
        baseUrl: "https://trinithrive.example.invalid",
        requiredScopes: ["trinithrive:read"],
        exposes: ["/health"],
        consumes: [],
        serviceType: "tribe",
        version: "1.0.0",
        ownerTeam: "trinithrive",
        contact: "ops@trinithrive.example.invalid",
      }),
    });
  }
}

async function publishEvents({ accessToken, baseUrl, concurrency, events }) {
  let accepted = 0;
  let failed = 0;
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < events.length) {
      const index = cursor;
      cursor += 1;
      try {
        let response;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            response = await jsonRequest(`${baseUrl}/api/v1/kafka/publish`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify(events[index]),
            });
            break;
          } catch (error) {
            if (attempt >= 3 || !isTransientPublishError(error)) throw error;
            await sleep(30_000);
          }
        }
        if (response.data?.accepted !== true) {
          throw new Error(`Unexpected publish response: ${JSON.stringify(response)}`);
        }
        accepted += 1;
        if (accepted % 500 === 0) {
          console.log(`accepted ${accepted}/${events.length}`);
        }
      } catch (error) {
        failed += 1;
        failures.push({
          index,
          key: events[index].key,
          eventType: events[index].eventType,
          error: error.message,
        });
        if (failures.length >= 10) return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );

  return { accepted, failed, failures };
}

async function main() {
  const options = {
    allowProd: args.has("--allow-prod"),
    concurrency: Number.parseInt(getArg("--concurrency", "4"), 10),
    csvDir: getArg("--csv-dir", path.join(os.homedir(), "AppData", "Local", "Temp")),
    dryRun: args.has("--dry-run"),
    envFile: getArg(
      "--env-file",
      path.resolve(__dirname, "..", "..", "..", "apicenter-management", ".env.test"),
    ),
    files: getArg("--files", DEFAULT_FILES.join(","))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    gcpProject: getArg("--gcp-project", "api-center-496422"),
    environment: getArg(
      "--environment",
      process.env.APICENTER_ENVIRONMENT || "",
    ),
    limit: Number.parseInt(getArg("--limit", "0"), 10),
    onlyKeys: getArg("--only-keys", "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    plaintextTribeSecret: getArg("--plaintext-tribe-secret", ""),
    register: !args.has("--skip-register"),
    rotateTestSecret: args.has("--rotate-test-secret"),
    sourceServiceId: getArg("--source-service-id", "trinithrive"),
    topicName: getArg("--topic-name", "tribe.trinithrive.events"),
    tribeId: getArg("--tribe-id", "trinithrive"),
  };

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new Error("--concurrency must be an integer from 1 to 12.");
  }

  importDotEnv(options.envFile);
  if (!options.environment) {
    options.environment = process.env.APICENTER_ENVIRONMENT || "";
  }

  const baseUrl = (process.env.APICENTER_URL || "").replace(/\/+$/g, "");
  if (!baseUrl) throw new Error("APICENTER_URL is required.");
  if (options.environment !== "test" && options.environment !== "live") {
    throw new Error("APICENTER_ENVIRONMENT or --environment must be test or live.");
  }
  const isProdTarget =
    options.environment === "live" ||
    options.topicName.startsWith("prod.") ||
    path.basename(options.envFile).includes("live");
  if (isProdTarget && !options.allowProd) {
    throw new Error("Refusing production target without --allow-prod.");
  }

  const platformAdminSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
  if (!platformAdminSecret) {
    throw new Error("API_CENTER_PLATFORM_ADMIN_SECRET is required for registration.");
  }

  const secretPrefix = process.env.TRIBE_SECRET_GCP_PREFIX || "api-center-tribe-secret-";
  const tribeSecretName = `${secretPrefix}${options.tribeId}-${options.environment}`;
  const built = buildEvents(options);
  const onlyKeySet = new Set(options.onlyKeys);
  const events = filterEventsByKeys(built.events, onlyKeySet);
  const summaries = built.summaries;
  const limitedBy = options.limit ? options.limit : null;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          base_url: baseUrl,
          topic: options.topicName,
          environment: options.environment,
          tribe_id: options.tribeId,
          source_service_id: options.sourceServiceId,
          tribe_secret_name: tribeSecretName,
          files: summaries,
          event_count: events.length,
          limited_by: limitedBy,
          only_keys: options.onlyKeys,
          sample_event: events[0],
        },
        null,
        2,
      ),
    );
    return;
  }

  let plaintextTribeSecret = options.plaintextTribeSecret;
  let rotatedTestSecret = false;
  if (!plaintextTribeSecret) {
    if (!options.rotateTestSecret || isProdTarget) {
      throw new Error(
        "Pass --plaintext-tribe-secret, or use --rotate-test-secret for a non-production target.",
      );
    }
    plaintextTribeSecret = smokeSecret();
    writeTribeSecretVersion({
      gcpProject: options.gcpProject,
      environment: options.environment,
      plaintextTribeSecret,
      tribeId: options.tribeId,
      tribeSecretName,
    });
    rotatedTestSecret = true;
  }

  if (options.register) {
    await registerTribe({
      baseUrl,
      platformAdminSecret,
      tribeId: options.tribeId,
      sourceServiceId: options.sourceServiceId,
    });
  }

  const accessToken = await getAccessToken({
    attempts: rotatedTestSecret ? 12 : 1,
    baseUrl,
    environment: options.environment,
    plaintextTribeSecret,
    tribeId: options.tribeId,
  });

  const publishResult = await publishEvents({
    accessToken,
    baseUrl,
    concurrency: options.concurrency,
    events,
  });

  console.log(
    JSON.stringify(
      {
        dry_run: false,
        base_url: baseUrl,
        topic: options.topicName,
        tribe_id: options.tribeId,
        source_service_id: options.sourceServiceId,
        rotated_test_secret: rotatedTestSecret,
        files: summaries,
        publish: publishResult,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildEventType,
  buildEvents,
  filterEventsByKeys,
  isUnauthorizedError,
  parseCsv,
  sanitizeRow,
};
