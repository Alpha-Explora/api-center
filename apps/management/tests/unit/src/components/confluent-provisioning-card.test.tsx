import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfluentProvisioningCard } from "@/components/confluent-provisioning-card";

const apiClient = vi.hoisted(() => ({
  getConfluentPipelineStatus: vi.fn(),
  includeConfluentTopicInS3Sink: vi.fn(),
  migrateLegacyTopic: vi.fn(),
  previewConfluentS3SinkIncludeTopic: vi.fn(),
  previewConfluentTopicProvision: vi.fn(),
  provisionConfluentTopic: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("sonner", () => ({
  toast: toastMock,
}));

const baseStatus = {
  serviceId: "smoke-tribe",
  topicName: "tribe.smoke-tribe.events",
  topicCheckOk: true,
  topicExists: false,
  s3SinkCheckOk: true,
  s3SinkIncludesTopic: false,
  connectorName: "api-center-s3-sink",
  topics: [],
};

describe("ConfluentProvisioningCard statuses", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "true");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("renders a disabled state without calling Confluent when the data pipeline is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "false");

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    expect(screen.getByText("Data pipeline disabled")).toBeTruthy();
    expect(apiClient.getConfluentPipelineStatus).not.toHaveBeenCalled();
  });

  it("shows checking while the status request is still pending", () => {
    apiClient.getConfluentPipelineStatus.mockImplementation(
      () => new Promise(() => undefined),
    );

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    expect(screen.getAllByText("Checking")).toHaveLength(2);
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("shows done only after both Confluent resources are confirmed", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      ...baseStatus,
      topicExists: true,
      s3SinkIncludesTopic: true,
      topics: ["tribe.smoke-tribe.events"],
    });

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    await waitFor(() => expect(screen.getAllByText("Done")).toHaveLength(2));
  });

  it("shows pending for resources that were checked but are missing", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue(baseStatus);

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    await waitFor(() => expect(screen.getAllByText("Pending")).toHaveLength(2));
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("shows not checked when the status endpoint skipped a resource check", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      ...baseStatus,
      topicCheckOk: false,
      s3SinkCheckOk: false,
    });

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    await waitFor(() =>
      expect(screen.getAllByText("Not checked")).toHaveLength(2),
    );
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("shows failed when the status check fails", async () => {
    apiClient.getConfluentPipelineStatus.mockRejectedValue(
      new Error("confluent unavailable"),
    );

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    await waitFor(
      () => expect(screen.getAllByText("Failed")).toHaveLength(2),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("shows the backend error when topic provisioning fails", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue(baseStatus);
    apiClient.provisionConfluentTopic.mockRejectedValue(
      new Error("Use a tribe event topic or a supported shared-service export topic"),
    );

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    fireEvent.click(await screen.findByRole("button", { name: /Provision topic/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Topic provisioning failed", {
        description:
          "Use a tribe event topic or a supported shared-service export topic",
      }),
    );
  });

  it("renders Confluent operation preview output", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue(baseStatus);
    apiClient.previewConfluentTopicProvision.mockResolvedValue({
      actionId: "confluent.topic.provision",
      environment: "test",
      risk: "provider-write",
      changes: ["Create or verify Kafka topic tribe.smoke-tribe.events"],
      reasonRequired: false,
    });

    renderWithClient(<ConfluentProvisioningCard serviceId="smoke-tribe" />);

    await screen.findAllByRole("button", { name: /Preview operation/i });
    fireEvent.click(screen.getAllByRole("button", { name: /Preview operation/i })[0]);

    await waitFor(() =>
      expect(
        screen.getByText("Create or verify Kafka topic tribe.smoke-tribe.events"),
      ).toBeTruthy(),
    );
  });

  it("shows legacy topic upgrade action for services owned by another tribe", async () => {
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      ...baseStatus,
      serviceId: "logistics-orders",
      topicName: "tribe.logistics.events",
    });
    apiClient.migrateLegacyTopic.mockResolvedValue({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      legacyTopic: "tribe.logistics-orders.events",
      targetTopic: "tribe.logistics.events",
      migrationNeeded: true,
      topicProvisioned: true,
      sinkIncluded: true,
      oldTopicPreserved: true,
    });

    renderWithClient(
      <ConfluentProvisioningCard
        serviceId="logistics-orders"
        ownerTribeId="logistics"
      />,
    );

    await screen.findByText(/Legacy topic detected/i);
    fireEvent.click(
      screen.getByRole("button", { name: /Upgrade legacy topic/i }),
    );

    await waitFor(() =>
      expect(apiClient.migrateLegacyTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          serviceType: "tribe",
        }),
      ),
    );
  });

  it("provisions the prefixed owner tribe topic when pointed at test", async () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      ...baseStatus,
      serviceId: "logistics-orders",
      topicName: "test.tribe.logistics.events",
    });
    apiClient.previewConfluentTopicProvision.mockResolvedValue({
      actionId: "confluent.topic.provision",
      environment: "test",
      risk: "provider-write",
      changes: ["Create or verify Kafka topic test.tribe.logistics.events"],
      reasonRequired: false,
    });

    renderWithClient(
      <ConfluentProvisioningCard
        serviceId="logistics-orders"
        ownerTribeId="logistics"
      />,
    );

    await screen.findByText("test.tribe.logistics.events");
    expect(apiClient.getConfluentPipelineStatus).toHaveBeenCalledWith(
      "logistics-orders",
      "test.tribe.logistics.events",
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /Preview operation/i })[0],
    );

    await waitFor(() =>
      expect(apiClient.previewConfluentTopicProvision).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          topicName: "test.tribe.logistics.events",
        }),
      ),
    );
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
