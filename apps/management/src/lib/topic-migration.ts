import {
  getTribeEventTopic,
  resolveTribeTopicOwner,
  type ServiceTopicType,
} from "@/lib/event-topics";

export type TopicMigrationInput = {
  serviceId: string;
  ownerTribeId?: string;
  serviceType?: ServiceTopicType;
};

export type TopicMigrationPlan = {
  serviceId: string;
  ownerTribeId: string;
  legacyTopic: string;
  targetTopic: string;
  migrationNeeded: boolean;
  reason: string;
};

export function planTopicMigration(
  input: TopicMigrationInput,
): TopicMigrationPlan {
  const serviceType = input.serviceType ?? "tribe";
  const ownerTribeId = resolveTribeTopicOwner(input);
  const legacyTopic = getTribeEventTopic(input.serviceId);
  const targetTopic = getTribeEventTopic(ownerTribeId);
  const migrationNeeded =
    serviceType === "tribe" && legacyTopic !== targetTopic;

  return {
    serviceId: input.serviceId,
    ownerTribeId,
    legacyTopic,
    targetTopic,
    migrationNeeded,
    reason: migrationNeeded
      ? `Service topic ${legacyTopic} should move to tribe topic ${targetTopic}.`
      : `Service ${input.serviceId} already uses tribe topic ${targetTopic}.`,
  };
}
