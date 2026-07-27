import type {
  ConfluentS3SinkIncludeTopicResponse,
  ConfluentS3SinkRemoveTopicResponse,
  ConfluentTopicProvisionRequest,
  ConfluentTopicProvisionResponse,
} from "@/lib/schemas";
import {
  getTribeEventTopic,
  resolveTribeTopicOwner,
} from "@/lib/event-topics";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type FetchLike = typeof fetch;

type ConfluentConfig = {
  environmentId: string;
  kafkaClusterId: string;
  kafkaRestEndpoint: string;
  kafkaApiKey: string;
  kafkaApiSecret: string;
  cloudApiKey: string;
  cloudApiSecret: string;
  s3ConnectorName: string;
  defaultRetentionMs: number;
};

export class ConfluentCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ConfluentCloudError";
  }
}

export function createConfluentCloudClient(fetchImpl: FetchLike = fetch) {
  return {
    provisionTopic: (input: ConfluentTopicProvisionRequest) =>
      provisionTopic(input, fetchImpl),
    includeTopicInS3Sink: (topicName: string) =>
      includeTopicInS3Sink(topicName, fetchImpl),
    removeTopicFromS3Sink: (topicName: string) =>
      removeTopicFromS3Sink(topicName, fetchImpl),
  };
}

export async function provisionConfluentTopic(
  input: ConfluentTopicProvisionRequest,
) {
  return createConfluentCloudClient().provisionTopic(input);
}

export async function includeConfluentTopicInS3Sink(topicName: string) {
  return createConfluentCloudClient().includeTopicInS3Sink(topicName);
}

export async function removeConfluentTopicFromS3Sink(topicName: string) {
  return createConfluentCloudClient().removeTopicFromS3Sink(topicName);
}

export async function getConfluentPipelineStatus(
  serviceId: string,
  ownerTribeId?: string,
) {
  return getPipelineStatus({ serviceId, ownerTribeId }, undefined, fetch);
}

async function provisionTopic(
  input: ConfluentTopicProvisionRequest,
  fetchImpl: FetchLike,
): Promise<ConfluentTopicProvisionResponse["data"]> {
  const config = getConfluentConfig();
  const ownerTribeId = resolveTribeTopicOwner(input);
  const topicName = input.topicName ?? getTribeEventTopic(ownerTribeId);
  const partitions = input.partitions ?? 1;
  const retentionMs = input.retentionMs ?? config.defaultRetentionMs;
  const topicUrl = kafkaTopicUrl(config, topicName);

  const existing = await fetchImpl(topicUrl, {
    method: "GET",
    headers: kafkaHeaders(config),
    cache: "no-store",
  });

  if (existing.ok) {
    return {
      serviceId: input.serviceId,
      ownerTribeId,
      topicName,
      clusterId: config.kafkaClusterId,
      created: false,
      existed: true,
      partitions,
      retentionMs,
    };
  }

  if (existing.status !== 404) {
    throw await confluentError("Failed to check Confluent topic", existing);
  }

  const created = await fetchImpl(kafkaTopicsUrl(config), {
    method: "POST",
    headers: kafkaHeaders(config),
    cache: "no-store",
    body: JSON.stringify({
      topic_name: topicName,
      partitions_count: partitions,
      configs: [
        { name: "cleanup.policy", value: "delete" },
        { name: "retention.ms", value: String(retentionMs) },
      ],
    }),
  });

  if (!created.ok && created.status !== 409) {
    throw await confluentError("Failed to create Confluent topic", created);
  }

  return {
    serviceId: input.serviceId,
    ownerTribeId,
    topicName,
    clusterId: config.kafkaClusterId,
    created: created.ok,
    existed: created.status === 409,
    partitions,
    retentionMs,
  };
}

async function getPipelineStatus(
  input: {
    serviceId: string;
    ownerTribeId?: string;
  },
  topicName: string | undefined,
  fetchImpl: FetchLike,
) {
  const config = getConfluentConfig();
  const ownerTribeId = resolveTribeTopicOwner(input);
  const resolvedTopicName = topicName ?? getTribeEventTopic(ownerTribeId);
  const topicStatus = await checkTopicStatus(config, resolvedTopicName, fetchImpl);
  const sinkStatus = await checkS3SinkStatus(config, resolvedTopicName, fetchImpl);

  return {
    serviceId: input.serviceId,
    ownerTribeId,
    topicName: resolvedTopicName,
    topicCheckOk: topicStatus.ok,
    topicExists: topicStatus.exists,
    topicCheckError: topicStatus.error,
    s3SinkCheckOk: sinkStatus.ok,
    s3SinkIncludesTopic: sinkStatus.includesTopic,
    s3SinkCheckError: sinkStatus.error,
    connectorName: config.s3ConnectorName,
    topics: sinkStatus.topics,
  };
}

export async function getConfluentPipelineStatusForTopic(
  serviceId: string,
  topicName: string,
) {
  return getPipelineStatus({ serviceId }, topicName, fetch);
}

async function checkTopicStatus(
  config: ConfluentConfig,
  topicName: string,
  fetchImpl: FetchLike,
) {
  try {
    return {
      ok: true,
      exists: await checkTopicExists(config, topicName, fetchImpl),
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      error: formatConfluentStatusError(error),
    };
  }
}

async function checkS3SinkStatus(
  config: ConfluentConfig,
  topicName: string,
  fetchImpl: FetchLike,
) {
  try {
    const connectorConfig = await readConnectorConfig(config, fetchImpl);
    const topics = parseTopics(connectorConfig.topics);

    return {
      ok: true,
      includesTopic: topics.includes(topicName),
      topics,
    };
  } catch (error) {
    return {
      ok: false,
      includesTopic: false,
      topics: [],
      error: formatConfluentStatusError(error),
    };
  }
}

async function checkTopicExists(
  config: ConfluentConfig,
  topicName: string,
  fetchImpl: FetchLike,
) {
  const response = await fetchImpl(kafkaTopicUrl(config, topicName), {
    method: "GET",
    headers: kafkaHeaders(config),
    cache: "no-store",
  });

  if (response.ok) return true;
  if (response.status === 404) return false;

  throw await confluentError("Failed to check Confluent topic", response);
}

function formatConfluentStatusError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Confluent status check failed.";
}

async function includeTopicInS3Sink(
  topicName: string,
  fetchImpl: FetchLike,
): Promise<ConfluentS3SinkIncludeTopicResponse["data"]> {
  const config = getConfluentConfig();
  const connectorConfig = await readConnectorConfig(config, fetchImpl);
  const topics = parseTopics(connectorConfig.topics);

  if (topics.includes(topicName)) {
    return {
      topicName,
      connectorName: config.s3ConnectorName,
      updated: false,
      alreadyIncluded: true,
      topics,
    };
  }

  const nextTopics = [...topics, topicName].sort();
  const update = await fetchImpl(connectorConfigUrl(config), {
    method: "PUT",
    headers: cloudHeaders(config),
    cache: "no-store",
    body: JSON.stringify({
      ...connectorConfig,
      topics: nextTopics.join(","),
    }),
  });

  if (!update.ok) {
    throw await confluentError("Failed to update S3 sink connector topics", update);
  }

  const verifiedConfig = await readConnectorConfig(config, fetchImpl);
  const verifiedTopics = parseTopics(verifiedConfig.topics);

  if (!verifiedTopics.includes(topicName)) {
    throw new ConfluentCloudError(
      "S3 sink connector update did not persist the requested topic.",
      502,
    );
  }

  return {
    topicName,
    connectorName: config.s3ConnectorName,
    updated: true,
    alreadyIncluded: false,
    topics: verifiedTopics,
  };
}

async function removeTopicFromS3Sink(
  topicName: string,
  fetchImpl: FetchLike,
): Promise<ConfluentS3SinkRemoveTopicResponse["data"]> {
  const config = getConfluentConfig();
  const connectorConfig = await readConnectorConfig(config, fetchImpl);
  const topics = parseTopics(connectorConfig.topics);

  if (!topics.includes(topicName)) {
    return {
      topicName,
      connectorName: config.s3ConnectorName,
      removed: false,
      wasIncluded: false,
      topics,
    };
  }

  const nextTopics = topics.filter((topic) => topic !== topicName).sort();
  const update = await fetchImpl(connectorConfigUrl(config), {
    method: "PUT",
    headers: cloudHeaders(config),
    cache: "no-store",
    body: JSON.stringify({
      ...connectorConfig,
      topics: nextTopics.join(","),
    }),
  });

  if (!update.ok) {
    throw await confluentError("Failed to remove topic from S3 sink", update);
  }

  const verifiedConfig = await readConnectorConfig(config, fetchImpl);
  const verifiedTopics = parseTopics(verifiedConfig.topics);

  if (verifiedTopics.includes(topicName)) {
    throw new ConfluentCloudError(
      "S3 sink connector update did not remove the requested topic.",
      502,
    );
  }

  return {
    topicName,
    connectorName: config.s3ConnectorName,
    removed: true,
    wasIncluded: true,
    topics: verifiedTopics,
  };
}

async function readConnectorConfig(
  config: ConfluentConfig,
  fetchImpl: FetchLike,
) {
  const response = await fetchImpl(connectorConfigUrl(config), {
    method: "GET",
    headers: cloudHeaders(config),
    cache: "no-store",
  });

  if (!response.ok) {
    throw await confluentError("Failed to read S3 sink connector config", response);
  }

  return normalizeConnectorConfig(await response.json());
}

function getConfluentConfig(): ConfluentConfig {
  const config = {
    environmentId: readEnv("CONFLUENT_ENVIRONMENT_ID"),
    kafkaClusterId: readEnv("CONFLUENT_KAFKA_CLUSTER_ID"),
    kafkaRestEndpoint: readEnv("CONFLUENT_KAFKA_REST_ENDPOINT").replace(
      /\/$/,
      "",
    ),
    kafkaApiKey: readEnv("CONFLUENT_KAFKA_API_KEY"),
    kafkaApiSecret: readEnv("CONFLUENT_KAFKA_API_SECRET"),
    cloudApiKey: readEnv("CONFLUENT_CLOUD_API_KEY"),
    cloudApiSecret: readEnv("CONFLUENT_CLOUD_API_SECRET"),
    s3ConnectorName: readEnv("CONFLUENT_S3_CONNECTOR_NAME"),
    defaultRetentionMs: Number(
      process.env.CONFLUENT_DEFAULT_RETENTION_MS || DEFAULT_RETENTION_MS,
    ),
  };

  if (!Number.isFinite(config.defaultRetentionMs) || config.defaultRetentionMs <= 0) {
    throw new ConfluentCloudError(
      "CONFLUENT_DEFAULT_RETENTION_MS must be a positive number.",
      500,
    );
  }

  return config;
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfluentCloudError(`${name} is required.`, 500);
  }

  return value;
}

function kafkaTopicsUrl(config: ConfluentConfig) {
  return `${config.kafkaRestEndpoint}/kafka/v3/clusters/${encodeURIComponent(
    config.kafkaClusterId,
  )}/topics`;
}

function kafkaTopicUrl(config: ConfluentConfig, topicName: string) {
  return `${kafkaTopicsUrl(config)}/${encodeURIComponent(topicName)}`;
}

function connectorConfigUrl(config: ConfluentConfig) {
  return `https://api.confluent.cloud/connect/v1/environments/${encodeURIComponent(
    config.environmentId,
  )}/clusters/${encodeURIComponent(
    config.kafkaClusterId,
  )}/connectors/${encodeURIComponent(config.s3ConnectorName)}/config`;
}

function kafkaHeaders(config: ConfluentConfig) {
  return {
    authorization: basicAuth(config.kafkaApiKey, config.kafkaApiSecret),
    "content-type": "application/json",
  };
}

function cloudHeaders(config: ConfluentConfig) {
  return {
    authorization: basicAuth(config.cloudApiKey, config.cloudApiSecret),
    "content-type": "application/json",
  };
}

function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64",
  )}`;
}

function normalizeConnectorConfig(raw: unknown) {
  const payload = raw as { config?: unknown };
  const config = payload.config ?? raw;

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ConfluentCloudError("Connector config response was not an object.");
  }

  return config as Record<string, string>;
}

function parseTopics(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
    ),
  ).sort();
}

async function confluentError(prefix: string, response: Response) {
  const detail = await response.text().catch(() => "");
  return new ConfluentCloudError(
    `${prefix}: ${response.status}${detail ? ` ${detail}` : ""}`,
    response.status,
  );
}
