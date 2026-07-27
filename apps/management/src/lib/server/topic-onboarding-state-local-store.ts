import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createTopicOnboardingStateRecord,
  recordTopicOnboardingObservation,
  type TopicOnboardingObservation,
  type TopicOnboardingStateRecord,
  type TopicOnboardingStateRecordInput,
} from "@/lib/service-onboarding";
import { topicOnboardingStateRecordSchema } from "@/lib/schemas";

type StoreOptions = {
  filePath?: string;
};

const topicOnboardingStateStoreSchema = z.object({
  records: z.array(topicOnboardingStateRecordSchema),
});

export async function getLocalTopicOnboardingStateRecord(
  physicalTopic: string,
  options: StoreOptions = {},
) {
  const store = await readStore(options);
  return store.records.find((record) => record.physical_topic === physicalTopic);
}

export async function getOrCreateLocalTopicOnboardingStateRecord(
  input: TopicOnboardingStateRecordInput,
  options: StoreOptions = {},
) {
  const physicalTopic =
    input.physicalTopic ??
    createTopicOnboardingStateRecord(input).physical_topic;
  const store = await readStore(options);
  const existing = store.records.find(
    (record) => record.physical_topic === physicalTopic,
  );

  if (existing) return existing;

  const record = createTopicOnboardingStateRecord({
    ...input,
    physicalTopic,
  });
  await writeStore({ records: [...store.records, record] }, options);
  return record;
}

export async function updateLocalTopicOnboardingStateRecord(
  physicalTopic: string,
  observation: TopicOnboardingObservation,
  options: StoreOptions = {},
) {
  const store = await readStore(options);
  const existing = store.records.find(
    (record) => record.physical_topic === physicalTopic,
  );
  const base =
    existing ??
    createTopicOnboardingStateRecord({
      serviceId: observation.serviceId,
      ownerTribeId: inferOwnerTribeIdFromTopic(physicalTopic),
      physicalTopic,
    });
  const next = recordTopicOnboardingObservation(base, observation);
  const records = [
    ...store.records.filter((record) => record.physical_topic !== physicalTopic),
    next,
  ].sort((left, right) => left.physical_topic.localeCompare(right.physical_topic));

  await writeStore({ records }, options);
  return next;
}

async function readStore(options: StoreOptions) {
  const filePath = resolveStorePath(options);

  try {
    const raw = await readFile(filePath, "utf8");
    return topicOnboardingStateStoreSchema.parse(JSON.parse(raw)) as {
      records: TopicOnboardingStateRecord[];
    };
  } catch (error) {
    if (isMissingFileError(error)) return { records: [] };
    throw error;
  }
}

async function writeStore(
  store: { records: TopicOnboardingStateRecord[] },
  options: StoreOptions,
) {
  const filePath = resolveStorePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function resolveStorePath(options: StoreOptions) {
  if (process.env.NODE_ENV !== "production") {
    return (
      options.filePath ??
      process.env.TOPIC_ONBOARDING_STATE_FILE ??
      ".local-state/topic-onboarding-states.json"
    );
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".local-state",
    "topic-onboarding-states.json",
  );
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

function isMissingFileError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
