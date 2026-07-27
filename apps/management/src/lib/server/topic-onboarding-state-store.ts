import type {
  TopicOnboardingObservation,
  TopicOnboardingStateRecord,
  TopicOnboardingStateRecordInput,
} from "@/lib/service-onboarding";
import {
  createTopicOnboardingStateRecord,
  recordTopicOnboardingObservation,
} from "@/lib/service-onboarding";
import { topicOnboardingStateResponseSchema } from "@/lib/schemas";

type StoreOptions = {
  filePath?: string;
  provider?: TopicOnboardingStateProvider;
};

type TopicOnboardingStateProvider = "local-file" | "api-center";

export async function getTopicOnboardingStateRecord(
  physicalTopic: string,
  options: StoreOptions = {},
) {
  const store = await loadStore(options);
  return store.getTopicOnboardingStateRecord(physicalTopic, options);
}

export async function getOrCreateTopicOnboardingStateRecord(
  input: TopicOnboardingStateRecordInput,
  options: StoreOptions = {},
) {
  const store = await loadStore(options);
  return store.getOrCreateTopicOnboardingStateRecord(input, options);
}

export async function updateTopicOnboardingStateRecord(
  physicalTopic: string,
  observation: TopicOnboardingObservation,
  options: StoreOptions = {},
) {
  const store = await loadStore(options);
  return store.updateTopicOnboardingStateRecord(physicalTopic, observation, options);
}

async function loadStore(options: StoreOptions) {
  const provider = resolveProvider(options);
  if (provider === "api-center") return apiCenterStore;

  if (process.env.NODE_ENV !== "production") {
    const localStore = await import("./topic-onboarding-state-local-store");
    return {
      getTopicOnboardingStateRecord:
        localStore.getLocalTopicOnboardingStateRecord,
      getOrCreateTopicOnboardingStateRecord:
        localStore.getOrCreateLocalTopicOnboardingStateRecord,
      updateTopicOnboardingStateRecord:
        localStore.updateLocalTopicOnboardingStateRecord,
    };
  }

  throw new Error(
    "TOPIC_ONBOARDING_STATE_PROVIDER=local-file is only supported in local development and tests.",
  );
}

function resolveProvider(options: StoreOptions): TopicOnboardingStateProvider {
  const provider =
    options.provider ?? process.env.TOPIC_ONBOARDING_STATE_PROVIDER;

  if (provider === "local-file" || provider === "api-center") {
    return provider;
  }

  if (provider) {
    throw new Error(
      "TOPIC_ONBOARDING_STATE_PROVIDER must be either local-file or api-center.",
    );
  }

  if (
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET ||
    process.env.NODE_ENV === "production"
  ) {
    return "api-center";
  }

  return "local-file";
}

const apiCenterStore = {
  async getTopicOnboardingStateRecord(physicalTopic: string) {
    return getApiCenterTopicOnboardingStateRecord(physicalTopic);
  },

  async getOrCreateTopicOnboardingStateRecord(
    input: TopicOnboardingStateRecordInput,
  ) {
    const physicalTopic =
      input.physicalTopic ?? createTopicOnboardingStateRecord(input).physical_topic;
    const existing = await getApiCenterTopicOnboardingStateRecord(physicalTopic);
    if (existing) return existing;

    const record = createTopicOnboardingStateRecord({
      ...input,
      physicalTopic,
    });
    return putApiCenterTopicOnboardingStateRecord(physicalTopic, record);
  },

  async updateTopicOnboardingStateRecord(
    physicalTopic: string,
    observation: TopicOnboardingObservation,
  ) {
    const existing = await getApiCenterTopicOnboardingStateRecord(physicalTopic);
    const base =
      existing ??
      createTopicOnboardingStateRecord({
        serviceId: observation.serviceId,
        ownerTribeId: inferOwnerTribeIdFromTopic(physicalTopic),
        physicalTopic,
      });
    const next = recordTopicOnboardingObservation(base, observation);
    return putApiCenterTopicOnboardingStateRecord(physicalTopic, next);
  },
};

async function getApiCenterTopicOnboardingStateRecord(physicalTopic: string) {
  const response = await apiCenterTopicStateRequest(
    `/api/v1/data-pipeline/topic-onboarding-states/${encodeURIComponent(
      physicalTopic,
    )}`,
  );
  if (response.status === 404) return undefined;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.error ??
        `API Center topic onboarding state lookup failed with ${response.status}.`,
    );
  }
  return topicOnboardingStateResponseSchema.parse(body).data;
}

async function putApiCenterTopicOnboardingStateRecord(
  physicalTopic: string,
  record: TopicOnboardingStateRecord,
) {
  const response = await apiCenterTopicStateRequest(
    `/api/v1/data-pipeline/topic-onboarding-states/${encodeURIComponent(
      physicalTopic,
    )}`,
    {
      method: "PUT",
      body: JSON.stringify({ record }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.error ??
        `API Center topic onboarding state upsert failed with ${response.status}.`,
    );
  }
  return topicOnboardingStateResponseSchema.parse(body).data;
}

function apiCenterTopicStateRequest(path: string, init?: RequestInit) {
  const platformSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
  if (!platformSecret) {
    throw new Error(
      "API_CENTER_PLATFORM_ADMIN_SECRET is required when TOPIC_ONBOARDING_STATE_PROVIDER=api-center.",
    );
  }
  const baseUrl = (
    process.env.API_CENTER_BASE_URL ?? "https://api-center.itsandbox.site"
  ).replace(/\/$/, "");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-platform-secret": platformSecret,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
}

function inferOwnerTribeIdFromTopic(physicalTopic: string) {
  const parts = physicalTopic.split(".");
  const tribeIndex = parts.indexOf("tribe");
  const eventsIndex = parts.lastIndexOf("events");

  if (tribeIndex >= 0 && eventsIndex > tribeIndex + 1) {
    return parts.slice(tribeIndex + 1, eventsIndex).join(".");
  }

  return undefined;
}
