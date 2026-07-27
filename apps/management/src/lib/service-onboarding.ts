import { getBrokenDependencies } from "@/lib/registry-view";
import {
  getServiceEventTopics,
  normalizeTopicIdentifier,
  resolveTribeTopicOwner,
} from "@/lib/event-topics";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export type OnboardingCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type TribeS3OnboardingState =
  | "Not configured"
  | "Data classification ready"
  | "Policy ready"
  | "Topic provisioned"
  | "Sink included"
  | "Publishing"
  | "Publishing but not flushed"
  | "Raw observed"
  | "Bronze cataloged"
  | "Curated active"
  | "Needs remediation"
  | "Rejected"
  | "Blocked by exception";

export type TribeTopicStateInputs = {
  classificationApproved?: boolean;
  hasScope?: boolean;
  topicExists?: boolean;
  s3SinkIncludesTopic?: boolean;
  lastAcceptedPublishAt?: string | null;
  latestS3ObjectKey?: string | null;
  latestS3ObjectAt?: string | null;
  latestBronzeObservedAt?: string | null;
  latestBronzeCount?: number | null;
  latestCommonSilverObservedAt?: string | null;
  latestGoldObservedAt?: string | null;
  qualityErrorCount?: number | null;
  curatedSignoffAt?: string | null;
  flushWindowExpired?: boolean;
  failureReason?: string | null;
  exceptionStatus?: "none" | "rejected" | "blocked_by_exception";
};

export type TopicOnboardingTransition = {
  previous_state: TribeS3OnboardingState;
  new_state: TribeS3OnboardingState;
  actor: string;
  approver?: string;
  timestamp: string;
  evidence_link?: string;
  blocking_reason?: string;
  next_review_date?: string;
};

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
  glue_database?: string;
  glue_table?: string;
  bronze_table?: string;
  current_state: TribeS3OnboardingState;
  classification_tier?: string;
  retention_tier?: string;
  data_owner?: string;
  data_steward?: string;
  approved_reader_groups: string[];
  publish_quota?: string;
  event_size_limit?: string;
  latest_accepted_publish_at?: string;
  latest_kafka_observed_at?: string;
  latest_s3_object_key?: string;
  latest_s3_object_at?: string;
  latest_bronze_observed_at?: string;
  latest_bronze_count?: number;
  latest_common_silver_observed_at?: string;
  latest_gold_observed_at?: string;
  quality_error_count?: number;
  curated_signoff_at?: string;
  exception_status: "none" | "rejected" | "blocked_by_exception";
  failure_reason?: string;
  last_access_review_at?: string;
  next_review_date?: string;
  transition_history: TopicOnboardingTransition[];
};

export type TopicOnboardingStateRecordInput = {
  serviceId: string;
  ownerTribeId?: string;
  sourceServiceIds?: string[];
  environment?: string;
  sourceSystem?: string;
  logicalTopic?: string;
  physicalTopic?: string;
  connectorName?: string;
  s3Prefix?: string;
  glueDatabase?: string;
  glueTable?: string;
  bronzeTable?: string;
  classificationTier?: string;
  retentionTier?: string;
  dataOwner?: string;
  dataSteward?: string;
  approvedReaderGroups?: string[];
  publishQuota?: string;
  eventSizeLimit?: string;
  lastAccessReviewAt?: string;
  nextReviewDate?: string;
  stateInputs?: TribeTopicStateInputs;
  currentState?: TribeS3OnboardingState;
  actor?: string;
  approver?: string;
  timestamp?: string;
  evidenceLink?: string;
  s3SinkConnectorRunningAt?: string;
  blockingReason?: string;
};

export type TopicOnboardingObservation = {
  serviceId: string;
  sourceServiceIds?: string[];
  actor: string;
  approver?: string;
  timestamp: string;
  evidenceLink?: string;
  blockingReason?: string;
  nextReviewDate?: string;
  stateInputs?: TribeTopicStateInputs;
  latestKafkaObservedAt?: string;
  latestS3ObjectKey?: string;
  latestBronzeCount?: number;
  latestCommonSilverObservedAt?: string;
  latestGoldObservedAt?: string;
  qualityErrorCount?: number;
  s3SinkConnectorRunningAt?: string;
  classificationTier?: string;
  retentionTier?: string;
  dataOwner?: string;
  dataSteward?: string;
  approvedReaderGroups?: string[];
  publishQuota?: string;
  eventSizeLimit?: string;
  lastAccessReviewAt?: string;
};

export type SdkServiceExample = {
  serviceId: string;
  label: string;
  summary: string;
  method: "GET" | "POST";
  path: string;
  scope: string;
  request: string;
  response: string;
  eventOutput: string;
  call: string;
};

const sdkServiceExamples: SdkServiceExample[] = [
  {
    serviceId: "gauth",
    label: "Google auth",
    summary: "Start Google OAuth through API Center.",
    method: "POST",
    path: "/oauth/authorize",
    scope: "shared:gauth:invoke",
    request: JSON.stringify(
      {
        redirectUri:
          "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
        scopes: ["openid", "email", "profile"],
      },
      null,
      2,
    ),
    response: JSON.stringify({ authorizationUrl: "https://accounts.google.com/..." }, null, 2),
    eventOutput: "gauth.oauth.start",
    call: createSharedServiceCallExample("gauth", "POST", "/oauth/authorize", {
      redirectUri:
        "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
      scopes: ["openid", "email", "profile"],
    }),
  },
  {
    serviceId: "geo",
    label: "Geo",
    summary: "Run geofence checks without giving tribes Google Maps keys.",
    method: "POST",
    path: "/geofence/check",
    scope: "shared:geo:invoke",
    request: JSON.stringify(
      {
        latitude: 14.5995,
        longitude: 120.9842,
        fenceId: "metro-manila",
      },
      null,
      2,
    ),
    response: JSON.stringify({ inside: true, fenceId: "metro-manila" }, null, 2),
    eventOutput: "geo.geofence.check",
    call: createSharedServiceCallExample("geo", "POST", "/geofence/check", {
      latitude: 14.5995,
      longitude: 120.9842,
      fenceId: "metro-manila",
    }),
  },
  {
    serviceId: "payment",
    label: "Payment",
    summary: "Create PayMongo-backed checkout sessions through the wrapper.",
    method: "POST",
    path: "/checkout/sessions",
    scope: "shared:payment:invoke",
    request: JSON.stringify(
      {
        amount: 50000,
        currency: "PHP",
        description: "Order #1001",
        successUrl: "https://app.example.com/payments/success",
        cancelUrl: "https://app.example.com/payments/cancel",
      },
      null,
      2,
    ),
    response: JSON.stringify({ checkoutUrl: "https://checkout.paymongo.com/..." }, null, 2),
    eventOutput: "paymongo.checkout.created",
    call: createSharedServiceCallExample("payment", "POST", "/checkout/sessions", {
      amount: 50000,
      currency: "PHP",
      description: "Order #1001",
      successUrl: "https://app.example.com/payments/success",
      cancelUrl: "https://app.example.com/payments/cancel",
    }),
  },
  {
    serviceId: "email",
    label: "Email",
    summary: "Send transactional email without exposing provider credentials.",
    method: "POST",
    path: "/send",
    scope: "shared:email:invoke",
    request: JSON.stringify(
      {
        to: "customer@example.com",
        subject: "Welcome",
        html: "<p>Hello from API Center</p>",
      },
      null,
      2,
    ),
    response: JSON.stringify({ messageId: "email_123" }, null, 2),
    eventOutput: "email.send",
    call: createSharedServiceCallExample("email", "POST", "/send", {
      to: "customer@example.com",
      subject: "Welcome",
      html: "<p>Hello from API Center</p>",
    }),
  },
  {
    serviceId: "sms",
    label: "SMS",
    summary: "Send SMS through the platform-selected SMS provider.",
    method: "POST",
    path: "/send",
    scope: "shared:sms:invoke",
    request: JSON.stringify(
      {
        to: "+639171234567",
        message: "Your verification code is 123456.",
      },
      null,
      2,
    ),
    response: JSON.stringify({ messageId: "sms_123", status: "queued" }, null, 2),
    eventOutput: "sms.send",
    call: createSharedServiceCallExample("sms", "POST", "/send", {
      to: "+639171234567",
      message: "Your verification code is 123456.",
    }),
  },
  {
    serviceId: "otp",
    label: "OTP",
    summary: "Generate and verify OTP challenges through API Center.",
    method: "POST",
    path: "/generate",
    scope: "shared:otp:invoke",
    request: JSON.stringify(
      {
        target: "customer@example.com",
        channel: "email",
        purpose: "login",
      },
      null,
      2,
    ),
    response: JSON.stringify({ otpId: "otp_123", expiresIn: 300 }, null, 2),
    eventOutput: "otp.issue",
    call: createSharedServiceCallExample("otp", "POST", "/generate", {
      target: "customer@example.com",
      channel: "email",
      purpose: "login",
    }),
  },
];

export function deriveTribeS3OnboardingState(
  inputs: TribeTopicStateInputs,
): TribeS3OnboardingState {
  if (inputs.exceptionStatus === "rejected") return "Rejected";
  if (inputs.exceptionStatus === "blocked_by_exception") {
    return "Blocked by exception";
  }
  if (inputs.failureReason) return "Needs remediation";
  if (!inputs.classificationApproved) return "Not configured";
  if (!inputs.hasScope) return "Data classification ready";
  if (!inputs.topicExists) return "Policy ready";
  if (!inputs.s3SinkIncludesTopic) return "Topic provisioned";
  if (!inputs.lastAcceptedPublishAt) return "Sink included";
  if (!inputs.latestS3ObjectAt) {
    return inputs.flushWindowExpired === false
      ? "Publishing"
      : "Publishing but not flushed";
  }
  if (!inputs.latestBronzeObservedAt) return "Raw observed";
  if (!inputs.curatedSignoffAt) return "Bronze cataloged";
  return "Curated active";
}

export function createTopicOnboardingStateRecord(
  input: TopicOnboardingStateRecordInput,
): TopicOnboardingStateRecord {
  const canonicalServiceId = normalizeTopicIdentifier(input.serviceId);
  const ownerTribeId = resolveTribeTopicOwner({
    serviceId: canonicalServiceId,
    ownerTribeId: input.ownerTribeId,
  });
  const logicalTopic = input.logicalTopic ?? `tribe.${ownerTribeId}.events`;
  const environment =
    input.environment ?? inferTopicEnvironment(input.physicalTopic, logicalTopic);
  const physicalTopic =
    input.physicalTopic ?? applyEnvironmentPrefix(logicalTopic, environment);
  const stateInputs = input.stateInputs
    ? applyEvidenceGatesToInitialStateInputs(input)
    : undefined;
  const currentState =
    input.currentState ?? deriveTribeS3OnboardingState(stateInputs ?? {});
  const timestamp = input.timestamp ?? new Date().toISOString();
  const sourceServiceIds = mergeSourceServiceIds(
    [canonicalServiceId],
    input.sourceServiceIds,
  );
  const record: TopicOnboardingStateRecord = {
    service_id: input.serviceId,
    canonical_service_id: canonicalServiceId,
    owner_tribe_id: ownerTribeId,
    canonical_tribe_id: ownerTribeId,
    source_service_ids: sourceServiceIds,
    environment,
    source_system: input.sourceSystem ?? ownerTribeId,
    logical_topic: logicalTopic,
    physical_topic: physicalTopic,
    connector_name: input.connectorName,
    s3_prefix:
      input.s3Prefix ??
      `s3://api-center-raw-data/topics/${physicalTopic.replace(/\/+$/, "")}/`,
    glue_database: input.glueDatabase,
    glue_table: input.glueTable,
    bronze_table: input.bronzeTable,
    current_state: currentState,
    classification_tier: input.classificationTier,
    retention_tier: input.retentionTier,
    data_owner: input.dataOwner,
    data_steward: input.dataSteward,
    approved_reader_groups: input.approvedReaderGroups ?? [],
    publish_quota: input.publishQuota,
    event_size_limit: input.eventSizeLimit,
    latest_accepted_publish_at: stateInputs?.lastAcceptedPublishAt ?? undefined,
    latest_s3_object_key: stateInputs?.latestS3ObjectKey ?? undefined,
    latest_s3_object_at: stateInputs?.latestS3ObjectAt ?? undefined,
    latest_bronze_observed_at:
      stateInputs?.latestBronzeObservedAt ?? undefined,
    latest_bronze_count: stateInputs?.latestBronzeCount ?? undefined,
    latest_common_silver_observed_at:
      stateInputs?.latestCommonSilverObservedAt ?? undefined,
    latest_gold_observed_at: stateInputs?.latestGoldObservedAt ?? undefined,
    quality_error_count: stateInputs?.qualityErrorCount ?? undefined,
    curated_signoff_at: stateInputs?.curatedSignoffAt ?? undefined,
    exception_status: stateInputs?.exceptionStatus ?? "none",
    failure_reason: stateInputs?.failureReason ?? undefined,
    last_access_review_at: input.lastAccessReviewAt,
    next_review_date: input.nextReviewDate,
    transition_history: [],
  };

  if (currentState !== "Not configured") {
    record.transition_history.push({
      previous_state: "Not configured",
      new_state: currentState,
      actor: input.actor ?? "system",
      approver: input.approver,
      timestamp,
      evidence_link: input.evidenceLink,
      blocking_reason: input.blockingReason,
      next_review_date: input.nextReviewDate,
    });
  }

  return record;
}

export function recordTopicOnboardingObservation(
  record: TopicOnboardingStateRecord,
  observation: TopicOnboardingObservation,
): TopicOnboardingStateRecord {
  const canonicalServiceId = normalizeTopicIdentifier(observation.serviceId);
  const stateInputs = observation.stateInputs
    ? applyEvidenceGatesToStateInputs(record, observation)
    : undefined;
  const derivedState = stateInputs
    ? deriveTribeS3OnboardingState(stateInputs)
    : record.current_state;
  const nextState = shouldKeepCurrentState(record.current_state, derivedState)
    ? record.current_state
    : derivedState;
  const nextRecord: TopicOnboardingStateRecord = {
    ...record,
    service_id: observation.serviceId,
    canonical_service_id: canonicalServiceId,
    source_service_ids: mergeSourceServiceIds(record.source_service_ids, [
      canonicalServiceId,
      ...(observation.sourceServiceIds ?? []),
    ]),
    current_state: nextState,
    classification_tier:
      observation.classificationTier ?? record.classification_tier,
    retention_tier: observation.retentionTier ?? record.retention_tier,
    data_owner: observation.dataOwner ?? record.data_owner,
    data_steward: observation.dataSteward ?? record.data_steward,
    approved_reader_groups:
      observation.approvedReaderGroups ?? record.approved_reader_groups,
    publish_quota: observation.publishQuota ?? record.publish_quota,
    event_size_limit: observation.eventSizeLimit ?? record.event_size_limit,
    latest_accepted_publish_at:
      stateInputs?.lastAcceptedPublishAt ??
      record.latest_accepted_publish_at,
    latest_kafka_observed_at:
      observation.latestKafkaObservedAt ?? record.latest_kafka_observed_at,
    latest_s3_object_key:
      observation.latestS3ObjectKey ??
      stateInputs?.latestS3ObjectKey ??
      record.latest_s3_object_key,
    latest_s3_object_at:
      stateInputs?.latestS3ObjectAt ?? record.latest_s3_object_at,
    latest_bronze_observed_at:
      stateInputs?.latestBronzeObservedAt ??
      record.latest_bronze_observed_at,
    latest_bronze_count:
      observation.latestBronzeCount ??
      stateInputs?.latestBronzeCount ??
      record.latest_bronze_count,
    latest_common_silver_observed_at:
      observation.latestCommonSilverObservedAt ??
      stateInputs?.latestCommonSilverObservedAt ??
      record.latest_common_silver_observed_at,
    latest_gold_observed_at:
      observation.latestGoldObservedAt ??
      stateInputs?.latestGoldObservedAt ??
      record.latest_gold_observed_at,
    quality_error_count:
      observation.qualityErrorCount ??
      stateInputs?.qualityErrorCount ??
      record.quality_error_count,
    curated_signoff_at:
      stateInputs?.curatedSignoffAt ?? record.curated_signoff_at,
    exception_status:
      stateInputs?.exceptionStatus ?? record.exception_status,
    failure_reason:
      stateInputs?.failureReason ?? record.failure_reason,
    last_access_review_at:
      observation.lastAccessReviewAt ?? record.last_access_review_at,
    next_review_date: observation.nextReviewDate ?? record.next_review_date,
    transition_history: [...record.transition_history],
  };

  if (nextState !== record.current_state) {
    nextRecord.transition_history.push({
      previous_state: record.current_state,
      new_state: nextState,
      actor: observation.actor,
      approver: observation.approver,
      timestamp: observation.timestamp,
      evidence_link: observation.evidenceLink,
      blocking_reason: observation.blockingReason,
      next_review_date: observation.nextReviewDate,
    });
  }

  return nextRecord;
}

function applyEvidenceGatesToStateInputs(
  record: TopicOnboardingStateRecord,
  observation: TopicOnboardingObservation,
): TribeTopicStateInputs {
  const inputs = { ...observation.stateInputs };

  if (inputs.topicExists && !hasTopicProvisionEvidence(observation)) {
    inputs.topicExists = hasReachedState(record.current_state, "Topic provisioned");
  }

  if (inputs.s3SinkIncludesTopic && !hasSinkInclusionEvidence(observation)) {
    inputs.s3SinkIncludesTopic = hasReachedState(record.current_state, "Sink included");
  }

  return inputs;
}

function applyEvidenceGatesToInitialStateInputs(
  input: TopicOnboardingStateRecordInput,
): TribeTopicStateInputs {
  const stateInputs = { ...input.stateInputs };

  if (
    stateInputs.topicExists &&
    !input.evidenceLink?.includes("/topics/") &&
    !stateInputs.latestS3ObjectAt &&
    !stateInputs.latestBronzeObservedAt
  ) {
    stateInputs.topicExists = false;
  }

  if (
    stateInputs.s3SinkIncludesTopic &&
    !input.s3SinkConnectorRunningAt &&
    !stateInputs.latestS3ObjectAt &&
    !stateInputs.latestBronzeObservedAt &&
    !stateInputs.curatedSignoffAt
  ) {
    stateInputs.s3SinkIncludesTopic = false;
  }

  return stateInputs;
}

function hasTopicProvisionEvidence(observation: TopicOnboardingObservation) {
  return Boolean(
    observation.evidenceLink?.includes("/topics/") ||
      observation.latestKafkaObservedAt ||
      observation.stateInputs?.latestS3ObjectAt ||
      observation.stateInputs?.latestBronzeObservedAt,
  );
}

function hasSinkInclusionEvidence(observation: TopicOnboardingObservation) {
  return Boolean(
    observation.s3SinkConnectorRunningAt ||
      observation.stateInputs?.latestS3ObjectAt ||
      observation.stateInputs?.latestBronzeObservedAt ||
      observation.stateInputs?.curatedSignoffAt,
  );
}

function hasReachedState(
  currentState: TribeS3OnboardingState,
  targetState: TribeS3OnboardingState,
) {
  return stateRank(currentState) >= stateRank(targetState);
}

export function getSdkServiceExamples(serviceIds?: string[]) {
  if (!serviceIds?.length) return sdkServiceExamples;

  const requested = new Set(serviceIds);
  return sdkServiceExamples.filter((example) => requested.has(example.serviceId));
}

export function getOnboardingChecks(
  service: ServiceRegistryEntry,
  services: ServiceRegistryEntry[],
): OnboardingCheck[] {
  const tribePrincipalId = getTribePrincipalId(service);
  const serviceType = service.serviceType === "shared" ? "shared" : "tribe";
  const broken = getBrokenDependencies(services).filter(
    (dependency) => dependency.sourceServiceId === service.serviceId,
  );

  return [
    {
      key: "owner",
      label: "Owner and contact",
      ok: Boolean(service.ownerTeam && service.contact),
      detail:
        service.ownerTeam && service.contact
          ? `${service.ownerTeam} / ${service.contact}`
          : "Set ownerTeam and contact before sending this to a tribe.",
    },
    {
      key: "health",
      label: "Health path",
      ok: Boolean(service.healthCheck),
      detail: service.healthCheck || "Add a healthCheck path.",
    },
    {
      key: "dependencies",
      label: "Consumed services",
      ok: broken.length === 0,
      detail: broken.length
        ? `Missing: ${broken.map((dependency) => dependency.targetServiceId).join(", ")}`
        : service.consumes.length
          ? `${service.consumes.length} dependency/dependencies registered.`
          : "No consumed services declared.",
    },
    {
      key: "sdk",
      label: "SDK configuration",
      ok: Boolean(service.serviceId && service.requiredScopes.length),
      detail: `APICENTER_TRIBE_ID=${tribePrincipalId}; scopes=${service.requiredScopes.join(", ")}`,
    },
    {
      key: "events",
      label: "Event topics",
      ok: true,
      detail: getServiceEventTopics({
        serviceId: service.serviceId,
        ownerTribeId: service.ownerTribeId,
        serviceType,
      }).primary,
    },
  ];
}

export function getOnboardingPacket(
  service: ServiceRegistryEntry,
  services: ServiceRegistryEntry[],
) {
  const tribePrincipalId = getTribePrincipalId(service);
  const serviceType = service.serviceType === "shared" ? "shared" : "tribe";
  const topics = getServiceEventTopics({
    serviceId: service.serviceId,
    ownerTribeId: service.ownerTribeId,
    serviceType,
  });
  const checks = getOnboardingChecks(service, services);

  return {
    serviceId: service.serviceId,
    tribePrincipalId,
    name: service.name,
    baseUrl: service.baseUrl,
    gatewayRoute:
      service.serviceType === "shared"
        ? `/api/v1/shared/${service.serviceId}`
        : `/api/v1/tribes/${service.serviceId}`,
    sdkEnv: {
      APICENTER_URL: "https://api-center.itsandbox.site",
      APICENTER_TRIBE_ID: tribePrincipalId,
      APICENTER_SERVICE_ID: service.serviceId,
      APICENTER_TRIBE_SECRET: "<issued-tribe-secret>",
    },
    scopes: service.requiredScopes,
    exposes: service.exposes,
    consumes: service.consumes,
    topics,
    checks,
  };
}

export function getTribeOnboardingPacket(service: ServiceRegistryEntry) {
  const tribePrincipalId = getTribePrincipalId(service);
  const serviceType = service.serviceType === "shared" ? "shared" : "tribe";
  const topics = getServiceEventTopics({
    serviceId: service.serviceId,
    ownerTribeId: service.ownerTribeId,
    serviceType,
  });
  const firstSharedService = service.consumes[0] ?? "gauth";
  const sharedServiceExamples = service.consumes.length
    ? service.consumes.map((serviceId) => {
        const curated = getSdkServiceExamples([serviceId])[0];
        return {
          serviceId,
          call:
            curated?.call ??
            createSharedServiceCallExample(serviceId, "GET", "/health"),
        };
      })
    : [
        {
          serviceId: firstSharedService,
          call: createSharedServiceCallExample(firstSharedService, "GET", "/health"),
        },
      ];

  return {
    serviceId: service.serviceId,
    platformActions: [
      "Register and review the tribe manifest.",
      "Generate the one-time tribe secret and provision only its SHA-256 hash.",
      `Create or verify ${topics.primary}.`,
      "Add the topic to the managed S3 Sink connector when exports should start.",
      "Run safe smoke checks and verify usage/audit signals.",
    ],
    tribeActions: [
      "Install @implementsprint/sdk in the tribe backend.",
      "Set APICENTER_URL, APICENTER_ENVIRONMENT, APICENTER_TRIBE_ID, APICENTER_SERVICE_ID, and APICENTER_TRIBE_SECRET as server-only env vars.",
      "Call shared services through API Center instead of provider APIs.",
      "Publish business events through the SDK when data should flow to S3.",
      "Do not store API Center credentials in frontend code.",
    ],
    env: [
      "# test",
      "APICENTER_URL=https://api-center.itsandbox.site",
      "APICENTER_ENVIRONMENT=test",
      `APICENTER_TRIBE_ID=${tribePrincipalId}`,
      `APICENTER_SERVICE_ID=${service.serviceId}`,
      "APICENTER_TRIBE_SECRET=<test-secret-issued-by-platform>",
      "",
      "# live",
      "APICENTER_URL=https://api-center.itsandbox.site",
      "APICENTER_ENVIRONMENT=live",
      `APICENTER_TRIBE_ID=${tribePrincipalId}`,
      `APICENTER_SERVICE_ID=${service.serviceId}`,
      "APICENTER_TRIBE_SECRET=<live-secret-issued-by-platform>",
    ].join("\n"),
    nestjsModule: createNestJsModuleExample(tribePrincipalId, service.serviceId),
    sharedServiceExamples,
    sdkServiceExamples: getSdkServiceExamples(),
    eventPublishing: createEventPublishingExample(
      tribePrincipalId,
      service.serviceId,
    ),
    customEventPublishing: createCustomEventPublishingExample(
      tribePrincipalId,
      service.serviceId,
    ),
    topics,
  };
}

function getTribePrincipalId(service: ServiceRegistryEntry) {
  return service.ownerTribeId ?? service.serviceId;
}

function mergeSourceServiceIds(
  current: string[],
  next: string[] = [],
) {
  return Array.from(
    new Set(
      [...current, ...next]
        .map((value) => normalizeTopicIdentifier(value))
        .filter(Boolean),
    ),
  ).sort();
}

function inferTopicEnvironment(
  physicalTopic: string | undefined,
  logicalTopic: string,
) {
  if (!physicalTopic || physicalTopic === logicalTopic) return "unprefixed";
  const suffix = `.${logicalTopic}`;
  if (physicalTopic.endsWith(suffix)) {
    return physicalTopic.slice(0, -suffix.length);
  }
  return "unprefixed";
}

function applyEnvironmentPrefix(logicalTopic: string, environment: string) {
  if (!environment || environment === "unprefixed") return logicalTopic;
  if (logicalTopic === environment || logicalTopic.startsWith(`${environment}.`)) {
    return logicalTopic;
  }
  return `${environment}.${logicalTopic}`;
}

function shouldKeepCurrentState(
  currentState: TribeS3OnboardingState,
  nextState: TribeS3OnboardingState,
) {
  if (
    nextState === "Needs remediation" ||
    nextState === "Rejected" ||
    nextState === "Blocked by exception"
  ) {
    return false;
  }

  return stateRank(nextState) < stateRank(currentState);
}

function stateRank(state: TribeS3OnboardingState) {
  const ranks: Record<TribeS3OnboardingState, number> = {
    "Not configured": 0,
    "Data classification ready": 1,
    "Policy ready": 2,
    "Topic provisioned": 3,
    "Sink included": 4,
    Publishing: 5,
    "Publishing but not flushed": 5,
    "Raw observed": 6,
    "Bronze cataloged": 7,
    "Curated active": 8,
    "Needs remediation": 9,
    Rejected: 9,
    "Blocked by exception": 9,
  };

  return ranks[state];
}

function createNestJsModuleExample(tribeId: string, sourceServiceId: string) {
  return [
    'import { Module, Global } from "@nestjs/common";',
    'import { TribeClient } from "@implementsprint/sdk";',
    "",
    "@Global()",
    "@Module({",
    "  providers: [",
    "    {",
    '      provide: "API_CENTER",',
    "      useFactory: () =>",
    "        new TribeClient({",
    "          gatewayUrl: process.env.APICENTER_URL!,",
    `          tribeId: process.env.APICENTER_TRIBE_ID ?? "${tribeId}",`,
    `          sourceServiceId: process.env.APICENTER_SERVICE_ID ?? "${sourceServiceId}",`,
    '          environment: process.env.APICENTER_ENVIRONMENT as "test" | "live",',
    "          secret: process.env.APICENTER_TRIBE_SECRET!,",
    "        }),",
    "    },",
    "  ],",
    '  exports: ["API_CENTER"],',
    "})",
    "export class ApiCenterModule {}",
  ].join("\n");
}

function createSharedServiceCallExample(
  serviceId: string,
  method: "GET" | "POST" = "GET",
  path = "/health",
  body?: Record<string, unknown>,
) {
  const lines = [
    "await apiCenter.callService({",
    `  targetServiceId: "${serviceId}",`,
    `  method: "${method}",`,
    `  path: "${path}",`,
  ];

  if (body) {
    lines.push(`  body: ${JSON.stringify(body, null, 2).replace(/\n/g, "\n  ")},`);
  }

  lines.push("});");
  return lines.join("\n");
}

function createEventPublishingExample(tribeId: string, sourceServiceId: string) {
  return [
    "await apiCenter.publishTribeEvent({",
    `  sourceServiceId: "${sourceServiceId}",`,
    '  eventType: "tribe.event.created",',
    "  payload: {",
    '    eventId: "evt_123",',
    '    source: "' + sourceServiceId + '",',
    '    tribeId: "' + tribeId + '",',
    "    occurredAt: new Date().toISOString(),",
    "  },",
    "});",
  ].join("\n");
}

function createCustomEventPublishingExample(
  tribeId: string,
  sourceServiceId: string,
) {
  return [
    "await apiCenter.publishTribeEvent({",
    `  sourceServiceId: "${sourceServiceId}",`,
    '  eventType: "order.created",',
    "  payload: {",
    '    orderId: "ord_123",',
    '    customerId: "cus_123",',
    '    tribeId: "' + tribeId + '",',
    "    amount: 50000,",
    '    currency: "PHP",',
    "    occurredAt: new Date().toISOString(),",
    "  },",
    "});",
  ].join("\n");
}
