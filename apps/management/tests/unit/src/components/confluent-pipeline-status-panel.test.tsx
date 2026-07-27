import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfluentPipelineStatusPanel,
  getConfluentPipelineDriftStates,
} from "../../../../src/components/confluent-pipeline-status-panel";
import type { ConfluentPipelineStatusResponse } from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getConfluentPipelineStatus: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

const baseStatus: ConfluentPipelineStatusResponse["data"] = {
  serviceId: "flow-ci",
  topicName: "test.tribe.flow-ci.events",
  topicCheckOk: true,
  topicExists: true,
  s3SinkCheckOk: true,
  s3SinkIncludesTopic: true,
  connectorName: "api-center-test-s3-sink",
  topics: ["test.tribe.flow-ci.events"],
};

describe("ConfluentPipelineStatusPanel", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "true");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("renders a disabled state without checking Confluent when the data pipeline is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "false");

    renderWithClient(
      <ConfluentPipelineStatusPanel serviceId="flow-ci" serviceType="tribe" />,
    );

    expect(screen.getByText("Data pipeline disabled")).toBeTruthy();
    expect(apiClient.getConfluentPipelineStatus).not.toHaveBeenCalled();
  });

  it("renders topic, connector, and drift status", async () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    apiClient.getConfluentPipelineStatus.mockResolvedValue(baseStatus);

    renderWithClient(
      <ConfluentPipelineStatusPanel serviceId="flow-ci" serviceType="tribe" />,
    );

    await waitFor(() =>
      expect(apiClient.getConfluentPipelineStatus).toHaveBeenCalledWith(
        "flow-ci",
        "test.tribe.flow-ci.events",
      ),
    );
    expect(screen.getByText("Pipeline status")).toBeTruthy();
    expect(await screen.findByText("api-center-test-s3-sink")).toBeTruthy();
    expect(await screen.findByText("in sync")).toBeTruthy();
  });

  it("uses owner tribe topic for owned microservices", async () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      ...baseStatus,
      serviceId: "logistics-orders",
      topicName: "test.tribe.logistics.events",
      topics: ["test.tribe.logistics.events"],
    });

    renderWithClient(
      <ConfluentPipelineStatusPanel
        serviceId="logistics-orders"
        ownerTribeId="logistics"
        serviceType="tribe"
      />,
    );

    await waitFor(() =>
      expect(apiClient.getConfluentPipelineStatus).toHaveBeenCalledWith(
        "logistics-orders",
        "test.tribe.logistics.events",
      ),
    );
  });

  it("detects pipeline drift states", () => {
    expect(
      getConfluentPipelineDriftStates({
        ...baseStatus,
        s3SinkIncludesTopic: false,
      }),
    ).toContain("topic exists but not in sink");

    expect(
      getConfluentPipelineDriftStates({
        ...baseStatus,
        topicExists: false,
        s3SinkIncludesTopic: true,
      }),
    ).toContain("sink includes topic but topic missing");

    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";
    expect(
      getConfluentPipelineDriftStates({
        ...baseStatus,
        s3SinkIncludesTopic: false,
        topics: ["tribe.flow-ci.events"],
      }),
    ).toContain("wrong prefix for environment");
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
