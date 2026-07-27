import { describe, expect, it } from "vitest";
import {
  createTopicOnboardingStateRecord,
  deriveTribeS3OnboardingState,
  getSdkServiceExamples,
  getTribeOnboardingPacket,
  recordTopicOnboardingObservation,
} from "../../../../src/lib/service-onboarding";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const service: ServiceRegistryEntry = {
  serviceId: "trinithrive",
  name: "TriniThrive",
  version: "1.0.0",
  baseUrl: "https://trinithrive.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "TriniThrive",
  contact: "ops@trinithrive.example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["gauth", "payment"],
  exposes: ["/health"],
  requiredScopes: ["shared:gauth:invoke", "shared:payment:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

describe("getTribeOnboardingPacket", () => {
  it("generates NestJS, service call, and event publishing handoff content", () => {
    const packet = getTribeOnboardingPacket(service);

    expect(packet.env).toContain("APICENTER_TRIBE_ID=trinithrive");
    expect(packet.nestjsModule).toContain("ApiCenterModule");
    expect(packet.nestjsModule).toContain("@implementsprint/sdk");
    expect(packet.sharedServiceExamples).toHaveLength(2);
    expect(packet.sharedServiceExamples[0].call).toContain(
      'targetServiceId: "gauth"',
    );
    expect(packet.eventPublishing).toContain("publishTribeEvent");
    expect(packet.eventPublishing).toContain('sourceServiceId: "trinithrive"');
    expect(packet.customEventPublishing).toContain('eventType: "order.created"');
    expect(packet.sdkServiceExamples.map((example) => example.serviceId)).toEqual([
      "gauth",
      "geo",
      "payment",
      "email",
      "sms",
      "otp",
    ]);
    expect(packet.topics.primary).toBe("tribe.trinithrive.events");
  });

  it("uses the owner tribe principal for owned microservice handoff content", () => {
    const packet = getTribeOnboardingPacket({
      ...service,
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      name: "Logistics Orders",
    });

    expect(packet.env).toContain("APICENTER_TRIBE_ID=logistics");
    expect(packet.nestjsModule).toContain(
      'tribeId: process.env.APICENTER_TRIBE_ID ?? "logistics"',
    );
    expect(packet.nestjsModule).toContain(
      'sourceServiceId: process.env.APICENTER_SERVICE_ID ?? "logistics-orders"',
    );
    expect(packet.eventPublishing).toContain(
      'sourceServiceId: "logistics-orders"',
    );
    expect(packet.topics.primary).toBe("tribe.logistics.events");
  });

  it("returns curated shared-service SDK examples with contracts", () => {
    const examples = getSdkServiceExamples();

    expect(examples).toHaveLength(6);
    expect(examples.find((example) => example.serviceId === "payment")).toMatchObject({
      method: "POST",
      path: "/checkout/sessions",
      scope: "shared:payment:invoke",
      eventOutput: "paymongo.checkout.created",
    });
    expect(examples.find((example) => example.serviceId === "otp")?.call).toContain(
      'targetServiceId: "otp"',
    );
  });
});

describe("deriveTribeS3OnboardingState", () => {
  it.each([
    [{}, "Not configured"],
    [{ classificationApproved: true }, "Data classification ready"],
    [
      { classificationApproved: true, hasScope: true },
      "Policy ready",
    ],
    [
      { classificationApproved: true, hasScope: true, topicExists: true },
      "Topic provisioned",
    ],
    [
      {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
      },
      "Sink included",
    ],
    [
      {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-19T00:00:00.000Z",
      },
      "Publishing but not flushed",
    ],
    [
      {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-19T00:00:00.000Z",
        latestS3ObjectAt: "2026-05-19T00:05:00.000Z",
      },
      "Raw observed",
    ],
    [
      {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-19T00:00:00.000Z",
        latestS3ObjectAt: "2026-05-19T00:05:00.000Z",
        latestBronzeObservedAt: "2026-05-19T00:10:00.000Z",
        latestBronzeCount: 1,
      },
      "Bronze cataloged",
    ],
    [
      {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-19T00:00:00.000Z",
        latestS3ObjectAt: "2026-05-19T00:05:00.000Z",
        latestBronzeObservedAt: "2026-05-19T00:10:00.000Z",
        curatedSignoffAt: "2026-05-19T00:15:00.000Z",
      },
      "Curated active",
    ],
    [{ failureReason: "Connector failed" }, "Needs remediation"],
    [{ exceptionStatus: "rejected" }, "Rejected"],
    [
      { exceptionStatus: "blocked_by_exception" },
      "Blocked by exception",
    ],
  ] as const)("derives %s as %s", (inputs, expected) => {
    expect(deriveTribeS3OnboardingState(inputs)).toBe(expected);
  });
});

describe("topic onboarding state records", () => {
  it("preserves transition history from sink inclusion through curated activation", () => {
    let record = createTopicOnboardingStateRecord({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      environment: "test",
      connectorName: "api-center-test-s3-sink",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
      },
      actor: "platform-operator",
      timestamp: "2026-05-20T00:00:00.000Z",
      evidenceLink: "confluent://lkc-test/topics/test.tribe.logistics.events",
      s3SinkConnectorRunningAt: "2026-05-20T00:00:00.000Z",
    });

    record = recordTopicOnboardingObservation(record, {
      serviceId: "logistics-orders",
      actor: "platform-operator",
      timestamp: "2026-05-20T00:05:00.000Z",
      evidenceLink: "audit://publish/1",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-20T00:05:00.000Z",
        flushWindowExpired: false,
      },
    });
    record = recordTopicOnboardingObservation(record, {
      serviceId: "logistics-orders",
      actor: "platform-operator",
      timestamp: "2026-05-20T00:10:00.000Z",
      evidenceLink: "s3://api-center-raw-data/topics/test.tribe.logistics.events/2026/05/20",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-20T00:05:00.000Z",
        latestS3ObjectAt: "2026-05-20T00:10:00.000Z",
      },
    });
    record = recordTopicOnboardingObservation(record, {
      serviceId: "logistics-orders",
      actor: "platform-operator",
      timestamp: "2026-05-20T00:15:00.000Z",
      evidenceLink: "athena://bronze/logistics/1",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-20T00:05:00.000Z",
        latestS3ObjectKey:
          "topics/test.tribe.logistics.events/year=2026/month=05/day=20/hour=00/part.json",
        latestS3ObjectAt: "2026-05-20T00:10:00.000Z",
        latestBronzeObservedAt: "2026-05-20T00:15:00.000Z",
        latestBronzeCount: 1,
        latestCommonSilverObservedAt: "2026-05-20T00:16:00.000Z",
        latestGoldObservedAt: "2026-05-20T00:17:00.000Z",
        qualityErrorCount: 0,
      },
    });
    record = recordTopicOnboardingObservation(record, {
      serviceId: "logistics-orders",
      actor: "tribe-product-owner",
      approver: "platform-bi-owner",
      timestamp: "2026-05-20T00:20:00.000Z",
      evidenceLink: "dashboard://logistics/orders",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-20T00:05:00.000Z",
        latestS3ObjectAt: "2026-05-20T00:10:00.000Z",
        latestBronzeObservedAt: "2026-05-20T00:15:00.000Z",
        curatedSignoffAt: "2026-05-20T00:20:00.000Z",
      },
    });

    expect(record.current_state).toBe("Curated active");
    expect(record.transition_history.map((entry) => entry.new_state)).toEqual([
      "Sink included",
      "Publishing",
      "Raw observed",
      "Bronze cataloged",
      "Curated active",
    ]);
    expect(record.transition_history.at(-1)).toMatchObject({
      previous_state: "Bronze cataloged",
      new_state: "Curated active",
      approver: "platform-bi-owner",
      evidence_link: "dashboard://logistics/orders",
    });
    expect(record.latest_s3_object_key).toBe(
      "topics/test.tribe.logistics.events/year=2026/month=05/day=20/hour=00/part.json",
    );
    expect(record.latest_bronze_count).toBe(1);
    expect(record.latest_common_silver_observed_at).toBe(
      "2026-05-20T00:16:00.000Z",
    );
    expect(record.latest_gold_observed_at).toBe("2026-05-20T00:17:00.000Z");
    expect(record.quality_error_count).toBe(0);
  });

  it("adds another source service without resetting an already onboarded tribe topic", () => {
    const curated = createTopicOnboardingStateRecord({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      environment: "prod",
      stateInputs: {
        classificationApproved: true,
        hasScope: true,
        topicExists: true,
        s3SinkIncludesTopic: true,
        lastAcceptedPublishAt: "2026-05-20T00:05:00.000Z",
        latestS3ObjectAt: "2026-05-20T00:10:00.000Z",
        latestBronzeObservedAt: "2026-05-20T00:15:00.000Z",
        curatedSignoffAt: "2026-05-20T00:20:00.000Z",
      },
      actor: "platform-operator",
      timestamp: "2026-05-20T00:20:00.000Z",
    });

    const next = recordTopicOnboardingObservation(curated, {
      serviceId: "logistics-inventory",
      actor: "platform-operator",
      timestamp: "2026-05-20T00:30:00.000Z",
    });

    expect(next.current_state).toBe("Curated active");
    expect(next.owner_tribe_id).toBe("logistics");
    expect(next.logical_topic).toBe("tribe.logistics.events");
    expect(next.physical_topic).toBe("prod.tribe.logistics.events");
    expect(next.source_service_ids).toEqual([
      "logistics-inventory",
      "logistics-orders",
    ]);
    expect(next.transition_history).toHaveLength(curated.transition_history.length);
  });
});
