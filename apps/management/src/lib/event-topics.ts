export type ServiceTopicType = "tribe" | "shared";

export type ServiceTopicInput = {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
  environment?: "test" | "staging" | "uat" | "demo" | "live";
};

export function normalizeTopicIdentifier(value: string) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]/g, "-");

  if (!normalized) {
    throw new Error("Topic identifier cannot be empty.");
  }

  if (/^[.-]|[.-]$/.test(normalized)) {
    throw new Error("Topic identifier cannot start or end with '.' or '-'.");
  }

  if (normalized.includes("..")) {
    throw new Error("Topic identifier cannot contain consecutive dots.");
  }

  return normalized;
}

export function resolveTribeTopicOwner(input: {
  serviceId: string;
  ownerTribeId?: string;
}) {
  return normalizeTopicIdentifier(input.ownerTribeId ?? input.serviceId);
}

export function getServiceEventTopics(
  input: ServiceTopicInput | string,
  serviceTypeArg?: ServiceTopicType,
) {
  const normalized =
    typeof input === "string"
      ? { serviceId: input, serviceType: serviceTypeArg }
      : input;
  const serviceType = normalized.serviceType ?? "tribe";
  const serviceId = normalizeTopicIdentifier(normalized.serviceId);
  const tribeTopicOwnerId = resolveTribeTopicOwner(normalized);
  const topicPrefix = normalized.environment ?? getDefaultTopicPrefix();
  const tribeEvents = getTribeEventTopic(tribeTopicOwnerId, topicPrefix);
  const sharedExport = getSharedServiceExportTopic(serviceId, topicPrefix);

  return {
    primary: serviceType === "shared" ? sharedExport : tribeEvents,
    primaryLabel:
      serviceType === "shared"
        ? "Shared-service export"
        : "Tribe events",
    tribeEvents,
    sharedExport,
    topicOwnerId:
      serviceType === "shared" ? serviceId : tribeTopicOwnerId,
    request: withTopicPrefix("api-center.tribe.request", topicPrefix),
    response: withTopicPrefix("api-center.tribe.response", topicPrefix),
    audit: withTopicPrefix("api-center.audit.log", topicPrefix),
  };
}

export function getTribeEventTopic(tribeId: string, explicitPrefix?: string) {
  return withTopicPrefix(
    `tribe.${normalizeTopicIdentifier(tribeId)}.events`,
    explicitPrefix,
  );
}

export function getSharedServiceExportTopic(
  serviceId: string,
  explicitPrefix?: string,
) {
  return withTopicPrefix(
    `api-center.shared.${normalizeTopicIdentifier(serviceId)}.events`,
    explicitPrefix,
  );
}

export function withTopicPrefix(topic: string, explicitPrefix?: string) {
  const prefix = (explicitPrefix ?? process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX ?? "")
    .trim()
    .replace(/\.+$/, "");

  if (!prefix) return topic;
  if (topic === prefix || topic.startsWith(`${prefix}.`)) return topic;

  return `${prefix}.${topic}`;
}

function getDefaultTopicPrefix() {
  return (process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX ?? "").trim();
}
