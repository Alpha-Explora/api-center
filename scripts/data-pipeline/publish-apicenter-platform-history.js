#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ENV_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "apicenter-management",
  ".env.test",
);
const DEFAULT_DAYS = 30;
const DEFAULT_TOTAL = 4000;
const APICENTER_PLATFORM_TOPICS = [
  "gateway.request",
  "gateway.response",
  "shared.payment.events",
  "pipeline.athena-query-execution",
];

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function importDotEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue;
    const [key, ...rest] = line.split("=");
    process.env[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

function normalizeOptions(input) {
  const environment = input.environment ?? "test";
  const days = Number.parseInt(String(input.days ?? DEFAULT_DAYS), 10);
  const total = Number.parseInt(String(input.total ?? DEFAULT_TOTAL), 10);
  const allowProd = Boolean(input.allowProd);
  const execute = Boolean(input.execute);
  const baseDate = input.baseDate ? new Date(input.baseDate) : new Date();
  const runId =
    input.runId ??
    `apicenter-platform-history-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (environment !== "test" && environment !== "prod") {
    throw new Error("--environment must be test or prod.");
  }
  if (environment === "prod" && !allowProd) {
    throw new Error("--allow-prod is required for prod synthetic history.");
  }
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("--days must be an integer from 1 to 90.");
  }
  if (!Number.isInteger(total) || total < days || total > 10000) {
    throw new Error("--total must be an integer from --days through 10000.");
  }
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error("--base-date must be an ISO date or timestamp.");
  }

  return {
    environment,
    days,
    total,
    allowProd,
    execute,
    baseDate,
    runId,
  };
}

function dayTimestamp(baseDate, dayOffset, sequence, countForDay) {
  const date = new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  date.setUTCDate(date.getUTCDate() - dayOffset);
  const slotSeconds = Math.floor((sequence / Math.max(countForDay, 1)) * 86400);
  date.setUTCSeconds(slotSeconds);
  return date.toISOString();
}

function dayKeyFromTimestamp(timestamp) {
  return timestamp.slice(0, 10);
}

function buildSyntheticHistoryEvents(options) {
  const normalized = normalizeOptions(options);
  const events = [];
  let emitted = 0;

  for (let dayOffset = 0; dayOffset < normalized.days; dayOffset += 1) {
    const remainingDays = normalized.days - dayOffset;
    const remainingEvents = normalized.total - emitted;
    const countForDay = Math.ceil(remainingEvents / remainingDays);

    for (let sequence = 0; sequence < countForDay; sequence += 1) {
      const occurredAt = dayTimestamp(
        normalized.baseDate,
        dayOffset,
        sequence,
        countForDay,
      );
      const topicKind = APICENTER_PLATFORM_TOPICS[events.length % APICENTER_PLATFORM_TOPICS.length];
      const event = buildEventForTopic({
        environment: normalized.environment,
        runId: normalized.runId,
        index: events.length + 1,
        topicKind,
        occurredAt,
      });
      events.push(event);
      emitted += 1;
    }
  }

  return events;
}

function buildEventForTopic(input) {
  const topic = `${input.environment}.api-center.${input.topicKind}`;
  const dayKey = dayKeyFromTimestamp(input.occurredAt);
  const key = `${input.runId}-${String(input.index).padStart(5, "0")}`;
  const basePayload = {
    eventId: key,
    eventType: eventTypeForTopic(input.topicKind),
    syntheticHistory: true,
    syntheticRunId: input.runId,
    generatedFor: "apicenter-ml-readiness-test",
    environment: input.environment,
    occurredAt: input.occurredAt,
    metadata: {
      schemaVersion: "synthetic-1.0.0",
      source: "publish-apicenter-platform-history",
    },
  };

  if (input.topicKind.startsWith("gateway.")) {
    const denied = input.index % 17 === 0;
    return {
      topic,
      key,
      dayKey,
      value: {
        ...basePayload,
        payload: {
          occurredAt: input.occurredAt,
          tribeId: "api-center-platform",
          sourceServiceId: "api-center-gateway",
          targetServiceId: input.index % 3 === 0 ? "payment" : "registry",
          scope: input.index % 3 === 0 ? "shared:payment:read" : "registry:read",
          decision: denied ? "denied" : "allowed",
          status: denied ? "403" : "200",
          latencyMs: String(40 + (input.index % 90)),
        },
      },
    };
  }

  if (input.topicKind === "shared.payment.events") {
    const failed = input.index % 23 === 0;
    return {
      topic,
      key,
      dayKey,
      value: {
        ...basePayload,
        sharedServiceId: "payment",
        tribeId: "api-center-platform",
        provider: "synthetic-payments",
        route: "/payments/health",
        method: "POST",
        statusCode: failed ? 502 : 200,
        ok: !failed,
        latencyMs: 80 + (input.index % 120),
        correlationId: key,
        payload: {
          occurredAt: input.occurredAt,
          sharedServiceId: "payment",
          tribeId: "api-center-platform",
          provider: "synthetic-payments",
          status: failed ? "failure" : "success",
        },
      },
    };
  }

  return {
    topic,
    key,
    dayKey,
    value: {
      ...basePayload,
      payload: {
        occurredAt: input.occurredAt,
        completedAt: input.occurredAt,
        workgroup: `api-center-platform-validation-${input.environment}`,
        resultPurpose: "synthetic-platform-history",
        queryExecutionId: `synthetic-${crypto
          .createHash("sha1")
          .update(key)
          .digest("hex")
          .slice(0, 16)}`,
        bytesScanned: input.index % 29 === 0 ? 2147483648 : 10485760,
        status: "SUCCEEDED",
        latencyMs: String(500 + (input.index % 500)),
      },
    },
  };
}

function eventTypeForTopic(topicKind) {
  if (topicKind === "gateway.request") return "gateway.request";
  if (topicKind === "gateway.response") return "gateway.response";
  if (topicKind === "shared.payment.events") return "shared-service.payment.request";
  return "athena.query.completed";
}

function deriveBrokerFromRestEndpoint(restEndpoint) {
  if (!restEndpoint) return "";
  const parsed = new URL(restEndpoint);
  return `${parsed.hostname}:9092`;
}

function resolveKafkaConfig(env = process.env) {
  const brokers = (env.KAFKA_BROKERS || deriveBrokerFromRestEndpoint(env.CONFLUENT_KAFKA_REST_ENDPOINT))
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);
  const username = env.KAFKA_SASL_USERNAME || env.CONFLUENT_KAFKA_API_KEY || "";
  const password = env.KAFKA_SASL_PASSWORD || env.CONFLUENT_KAFKA_API_SECRET || "";

  if (brokers.length === 0) {
    throw new Error("KAFKA_BROKERS or CONFLUENT_KAFKA_REST_ENDPOINT is required.");
  }
  if (!username || !password) {
    throw new Error("KAFKA_SASL_USERNAME/KAFKA_SASL_PASSWORD or Confluent Kafka API credentials are required.");
  }

  return {
    clientId: env.KAFKA_CLIENT_ID || "api-center-synthetic-history",
    brokers,
    ssl: env.KAFKA_SSL_ENABLED === "false" ? false : true,
    sasl: {
      mechanism: "plain",
      username,
      password,
    },
  };
}

async function publishEvents(events, kafkaConfig) {
  const { Kafka, logLevel } = require("kafkajs");
  const kafka = new Kafka({ ...kafkaConfig, logLevel: logLevel.WARN });
  const producer = kafka.producer();
  const byTopic = new Map();

  for (const event of events) {
    if (!byTopic.has(event.topic)) byTopic.set(event.topic, []);
    byTopic.get(event.topic).push({
      key: event.key,
      value: JSON.stringify(event.value),
    });
  }

  await producer.connect();
  try {
    for (const [topic, messages] of byTopic.entries()) {
      for (let index = 0; index < messages.length; index += 100) {
        await producer.send({
          topic,
          messages: messages.slice(index, index + 100),
        });
      }
    }
  } finally {
    await producer.disconnect();
  }
}

function summarizeEvents(events, options) {
  const topicCounts = {};
  const dayCounts = {};
  for (const event of events) {
    topicCounts[event.topic] = (topicCounts[event.topic] ?? 0) + 1;
    dayCounts[event.dayKey] = (dayCounts[event.dayKey] ?? 0) + 1;
  }

  return {
    environment: options.environment,
    execute: options.execute,
    synthetic_run_id: options.runId,
    total_events: events.length,
    day_count: Object.keys(dayCounts).length,
    first_day: Object.keys(dayCounts).sort()[0],
    latest_day: Object.keys(dayCounts).sort().at(-1),
    topics: topicCounts,
  };
}

async function main() {
  const envFile = path.resolve(getArg("--env-file", DEFAULT_ENV_FILE));
  importDotEnv(envFile);

  const options = normalizeOptions({
    environment: getArg("--environment", "test"),
    days: getArg("--days", String(DEFAULT_DAYS)),
    total: getArg("--total", String(DEFAULT_TOTAL)),
    baseDate: getArg("--base-date", new Date().toISOString()),
    runId: getArg("--run-id", undefined),
    allowProd: hasArg("--allow-prod"),
    execute: hasArg("--execute"),
  });
  const events = buildSyntheticHistoryEvents(options);
  const summary = summarizeEvents(events, options);

  if (!options.execute) {
    console.log(JSON.stringify({ ...summary, dry_run: true }, null, 2));
    return;
  }

  const kafkaConfig = resolveKafkaConfig();
  await publishEvents(events, kafkaConfig);
  console.log(JSON.stringify({ ...summary, dry_run: false, published: true }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildSyntheticHistoryEvents,
  deriveBrokerFromRestEndpoint,
  normalizeOptions,
  resolveKafkaConfig,
  summarizeEvents,
};
