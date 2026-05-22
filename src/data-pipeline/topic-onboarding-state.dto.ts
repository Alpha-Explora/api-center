export type TopicOnboardingStateRecord = {
  service_id: string;
  canonical_service_id: string;
  owner_tribe_id: string;
  canonical_tribe_id: string;
  source_service_ids: string[];
  environment: string;
  source_system: string;
  logical_topic: string;
  physical_topic: string;
  connector_name?: string;
  s3_prefix: string;
  current_state: string;
  approved_reader_groups: string[];
  exception_status: "none" | "rejected" | "blocked_by_exception";
  transition_history: unknown[];
  [key: string]: unknown;
};

export type TopicOnboardingStateUpsertDto = {
  record: TopicOnboardingStateRecord;
};
