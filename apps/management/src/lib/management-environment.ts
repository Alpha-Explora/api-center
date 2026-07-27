export type ManagementEnvironmentKey = "local" | "test" | "live";

export type ManagementEnvironment = {
  key: ManagementEnvironmentKey;
  label: string;
  description: string;
  isLive: boolean;
};

const environments: Record<ManagementEnvironmentKey, ManagementEnvironment> = {
  local: {
    key: "local",
    label: "LOCAL",
    description: "Local/private management session",
    isLive: false,
  },
  test: {
    key: "test",
    label: "TEST",
    description: "Test API Center environment",
    isLive: false,
  },
  live: {
    key: "live",
    label: "LIVE",
    description: "Live API Center environment",
    isLive: true,
  },
};

export function getManagementEnvironment() {
  return normalizeManagementEnvironment(
    process.env.MANAGEMENT_ENVIRONMENT ||
      process.env.MANAGEMENT_ENV ||
      process.env.NEXT_PUBLIC_MANAGEMENT_ENV ||
      process.env.APP_ENV,
  );
}

export function normalizeManagementEnvironment(value: string | undefined) {
  const key = value?.trim().toLowerCase();

  if (key === "test" || key === "live" || key === "local") {
    return environments[key];
  }

  return environments.local;
}

export function getKafkaTopicPrefix() {
  return (
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX ||
    process.env.KAFKA_TOPIC_PREFIX ||
    ""
  )
    .trim()
    .replace(/\.+$/, "");
}
