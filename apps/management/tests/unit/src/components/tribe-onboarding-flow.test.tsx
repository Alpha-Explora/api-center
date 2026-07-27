import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeOnboardingFlow } from "../../../../src/components/tribe-onboarding-flow";

const apiClient = vi.hoisted(() => ({
  getConfluentPipelineStatus: vi.fn(),
  getTopicOnboardingState: vi.fn(),
  getTribeSecretStatus: vi.fn(),
  listQuotaPolicies: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("TribeOnboardingFlow", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "true");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("skips Confluent and S3 checks when the data pipeline is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "false");
    apiClient.getTribeSecretStatus.mockResolvedValue({ exists: true });
    apiClient.listQuotaPolicies.mockResolvedValue([]);

    renderWithClient(<TribeOnboardingFlow serviceId="flow-ci" consumes={[]} />);

    expect(await screen.findByText("Tribe secret provisioned")).toBeTruthy();
    expect(screen.getAllByText("Skipped")).toHaveLength(3);
    expect(screen.getByText("Token issued")).toBeTruthy();
    expect(apiClient.getConfluentPipelineStatus).not.toHaveBeenCalled();
    expect(apiClient.getTopicOnboardingState).not.toHaveBeenCalled();
  });

  it("checks the prefixed Confluent topic used by the provisioning card", async () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    apiClient.getTribeSecretStatus.mockResolvedValue({ exists: true });
    apiClient.getTopicOnboardingState.mockResolvedValue(undefined);
    apiClient.listQuotaPolicies.mockResolvedValue([]);
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      serviceId: "flow-ci",
      topicName: "test.tribe.flow-ci.events",
      topicCheckOk: true,
      topicExists: true,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: true,
      connectorName: "api-center-test-s3-sink",
      topics: ["test.tribe.flow-ci.events"],
    });

    renderWithClient(<TribeOnboardingFlow serviceId="flow-ci" consumes={[]} />);

    await waitFor(() =>
      expect(apiClient.getConfluentPipelineStatus).toHaveBeenCalledWith(
        "flow-ci",
        "test.tribe.flow-ci.events",
      ),
    );
    expect(await screen.findByText("Confluent topic created")).toBeTruthy();
    expect(screen.getByText("S3 onboarding state")).toBeTruthy();
    expect(
      screen.getByText(/Sink included.*test\.tribe\.flow-ci\.events/),
    ).toBeTruthy();
    expect(screen.getByText("Shared-service access declared")).toBeTruthy();
    expect(screen.getByText("Token issued")).toBeTruthy();
    expect(screen.getByText("Safe smoke checks pass")).toBeTruthy();
  });

  it("checks owner tribe secret and topic for owned microservices", async () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    apiClient.getTribeSecretStatus.mockResolvedValue({ exists: true });
    apiClient.listQuotaPolicies.mockResolvedValue([
      {
        id: "quota-logistics",
        ownerTribeId: "logistics",
        scope: "shared",
        targetServiceId: "payment",
        windowSeconds: 60,
        maxRequests: 100,
        burstRequests: null,
        mode: "enforce",
        status: "active",
        reason: "Protect provider spend",
        updatedAt: "2026-05-25T02:00:00.000Z",
      },
    ]);
    apiClient.getTopicOnboardingState.mockResolvedValue({
      service_id: "logistics-orders",
      canonical_service_id: "logistics-orders",
      owner_tribe_id: "logistics",
      canonical_tribe_id: "logistics",
      source_service_ids: ["logistics-orders", "logistics-inventory"],
      environment: "test",
      source_system: "logistics",
      logical_topic: "tribe.logistics.events",
      physical_topic: "test.tribe.logistics.events",
      connector_name: "api-center-test-s3-sink",
      s3_prefix: "s3://api-center-raw-data/topics/test.tribe.logistics.events/",
      current_state: "Curated active",
      classification_tier: "internal",
      retention_tier: "standard-365",
      data_owner: "logistics-product-owner",
      data_steward: "platform-data-steward",
      approved_reader_groups: ["bi-logistics-readers"],
      publish_quota: "1000/min",
      event_size_limit: "64KB",
      latest_s3_object_key:
        "topics/test.tribe.logistics.events/year=2026/month=05/day=20/hour=09/part.json",
      latest_s3_object_at: "2026-05-20T09:41:51.000Z",
      latest_bronze_observed_at: "2026-05-20T09:45:00.000Z",
      latest_bronze_count: 1000,
      latest_common_silver_observed_at: "2026-05-20T09:47:00.000Z",
      latest_gold_observed_at: "2026-05-20T09:50:00.000Z",
      quality_error_count: 0,
      last_access_review_at: "2026-05-19T00:00:00.000Z",
      exception_status: "none",
      next_review_date: "2026-06-19",
      transition_history: [
        {
          previous_state: "Bronze cataloged",
          new_state: "Curated active",
          actor: "tribe-product-owner",
          approver: "platform-bi-owner",
          timestamp: "2026-05-20T00:20:00.000Z",
          evidence_link: "dashboard://logistics/orders",
        },
      ],
    });
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      serviceId: "logistics-orders",
      topicName: "test.tribe.logistics.events",
      topicCheckOk: true,
      topicExists: true,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: true,
      connectorName: "api-center-test-s3-sink",
      topics: ["test.tribe.logistics.events"],
    });

    renderWithClient(
      <TribeOnboardingFlow
        serviceId="logistics-orders"
        ownerTribeId="logistics"
        consumes={[]}
        requiredScopes={["external:kafka:write"]}
      />,
    );

    await waitFor(() =>
      expect(apiClient.getTribeSecretStatus).toHaveBeenCalledWith("logistics"),
    );
    expect(apiClient.getConfluentPipelineStatus).toHaveBeenCalledWith(
      "logistics-orders",
      "test.tribe.logistics.events",
    );
    expect(await screen.findByText(/under tribe logistics/)).toBeTruthy();
    expect(
      screen.getByText(
        /Owner tribe topic: test\.tribe\.logistics\.events; source service logistics-orders/,
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Topic state record")).toBeTruthy();
    expect(screen.getByText("internal")).toBeTruthy();
    expect(screen.getByText("standard-365")).toBeTruthy();
    expect(screen.getByText("logistics-product-owner")).toBeTruthy();
    expect(screen.getByText("bi-logistics-readers")).toBeTruthy();
    expect(screen.getByText("1000/min")).toBeTruthy();
    expect(
      screen.getByText(/year=2026\/month=05\/day=20\/hour=09/),
    ).toBeTruthy();
    expect(screen.getByText("2026-05-20T09:41:51.000Z")).toBeTruthy();
    expect(screen.getByText("2026-05-20T09:45:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-05-20T09:47:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-05-20T09:50:00.000Z")).toBeTruthy();
    expect(screen.getByText("1000")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("2026-05-19T00:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-06-19")).toBeTruthy();
    expect(
      screen.getByText("logistics-orders, logistics-inventory"),
    ).toBeTruthy();
    expect(screen.getByText("Active quota policy")).toBeTruthy();
    expect(
      screen.getByText(/enforce shared quota: 100 requests per 60s/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open quotas" }).getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=quotas");
    expect(
      screen
        .getByRole("button", { name: "Open token test" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=actions");
    expect(
      screen
        .getByRole("button", { name: "Open smoke tests" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=actions");
    expect(
      screen.getByRole("button", { name: "Open usage" }).getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=dependencies");
  });

  it("shows the platform throttle fallback when a tribe has no quota policy", async () => {
    apiClient.getTribeSecretStatus.mockResolvedValue({ exists: false });
    apiClient.getTopicOnboardingState.mockResolvedValue(undefined);
    apiClient.listQuotaPolicies.mockResolvedValue([]);
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      serviceId: "flow-ci",
      topicName: "tribe.flow-ci.events",
      topicCheckOk: true,
      topicExists: false,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: false,
      connectorName: "api-center-test-s3-sink",
      topics: [],
    });

    renderWithClient(<TribeOnboardingFlow serviceId="flow-ci" consumes={[]} />);

    expect(
      await screen.findByText("Default platform throttle applies"),
    ).toBeTruthy();
    expect(screen.getByText("Quota policy")).toBeTruthy();
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
