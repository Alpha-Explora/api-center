import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDataPipelineCost,
  getDataPipelineDecisionSignals,
  getDataPipelineGatewayDecisions,
  getDataPipelineHealth,
  getDataPipelineQuality,
} from "@/lib/api-center-client";
import { DataPipelineDashboardClient } from "../../../../src/components/data-pipeline-dashboard-client";

vi.mock("@/lib/api-center-client", () => ({
  getDataPipelineHealth: vi.fn(async () => [
    {
      environment: "test",
      tribeId: "codex",
      eventType: "codex.pipeline.flush",
      eventDay: "2026-05-20",
      eventCount: 1,
    },
  ]),
  getDataPipelineQuality: vi.fn(async () => []),
  getDataPipelineSharedServiceUsage: vi.fn(async () => []),
  getDataPipelineGatewayDecisions: vi.fn(async () => []),
  getDataPipelineCost: vi.fn(async () => []),
  getDataPipelineDecisionSignals: vi.fn(async () => []),
  previewRawToSilverRun: vi.fn(async () => ({
    status: "preview",
    environment: "test",
    tribeId: "greenovate",
    physicalTopic: "test.tribe.greenovate.events",
    partition: { year: "2026", month: "05", day: "22" },
    startedAt: "2026-05-23T01:00:00.000Z",
    raw: {},
    bronze: {},
    commonSilver: {},
    previewQueries: {
      raw: "SELECT COUNT(*)",
      bronze: "SELECT COUNT(*)",
      commonSilver: "SELECT COUNT(*)",
    },
  })),
  startRawToSilverRun: vi.fn(async () => ({
    status: "completed",
    environment: "test",
    tribeId: "greenovate",
    physicalTopic: "test.tribe.greenovate.events",
    partition: { year: "2026", month: "05", day: "22" },
    startedAt: "2026-05-23T01:00:00.000Z",
    completedAt: "2026-05-23T01:01:00.000Z",
    raw: { rowCount: 8 },
    bronze: { rowCount: 8 },
    commonSilver: { rowCount: 8 },
    previewQueries: {
      raw: "SELECT COUNT(*)",
      bronze: "SELECT COUNT(*)",
      commonSilver: "SELECT COUNT(*)",
    },
  })),
}));

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
      <QueryClientProvider client={queryClient}>
        <DataPipelineDashboardClient
        biConfig={{
          enabled: false,
          provider: "none",
        }}
      />
    </QueryClientProvider>,
  );
}

describe("DataPipelineDashboardClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the north-star summary and supporting view tabs", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("North-star answer")).toBeTruthy();
    });

    expect(screen.getByRole("tab", { name: "Traceability" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Governance" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cost" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Analytics" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "BI" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Runs" })).toBeTruthy();
  });

  it("defaults governance reads to the 30-day test window", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(getDataPipelineGatewayDecisions).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          year: expect.any(String),
          month: expect.any(String),
          day: expect.any(String),
        }),
        30,
      );
    });

    expect(getDataPipelineCost).toHaveBeenCalledWith(
      "test",
      expect.any(Object),
      30,
    );
    expect(getDataPipelineDecisionSignals).toHaveBeenCalledWith(
      "test",
      expect.any(Object),
      30,
    );
    expect(
      screen
        .getByRole("button", { name: "30 days" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("maps the public Live toggle to the physical prod pipeline lane", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Live" }));

    await waitFor(() => {
      expect(getDataPipelineHealth).toHaveBeenCalledWith(
        "prod",
        expect.objectContaining({
          year: expect.any(String),
          month: expect.any(String),
          day: expect.any(String),
        }),
      );
    });
  });

  it("shows a recovery path when no pipeline actions need attention", async () => {
    renderDashboard();

    expect(
      await screen.findByText("No pipeline actions need attention"),
    ).toBeTruthy();
    expect(screen.getByText("Recovery path")).toBeTruthy();
    expect(screen.getByText("Verify raw-to-silver telemetry")).toBeTruthy();
    expect(screen.getByText("Check gateway decision export")).toBeTruthy();
    expect(screen.getByText("Refresh the partition window")).toBeTruthy();
  });

  it("surfaces severity-first pipeline action detail before the source tabs", async () => {
    vi.mocked(getDataPipelineQuality).mockResolvedValueOnce([
      {
        environment: "test",
        tribeId: "codex",
        sourceServiceId: "student-api",
        eventType: "student.created",
        eventDay: "2026-05-20",
        eventCount: 12,
        validEventCount: 10,
        invalidEventCount: 2,
        qualityErrorCount: 2,
        latestQualityError: "missing required field: studentId",
        latestObservedAt: "2026-05-20T01:00:00.000Z",
      },
    ]);
    vi.mocked(getDataPipelineGatewayDecisions).mockResolvedValueOnce([
      {
        environment: "test",
        tribeId: "codex",
        sourceServiceId: "student-api",
        targetServiceId: "profile-api",
        scope: "profiles:read",
        decision: "denied",
        eventDay: "2026-05-20",
        decisionCount: 3,
        allowedCount: 0,
        deniedCount: 3,
      },
    ]);
    vi.mocked(getDataPipelineDecisionSignals).mockResolvedValueOnce([
      {
        signalId: "sig-1",
        environment: "test",
        tribeId: "codex",
        sourceServiceId: "student-api",
        signalType: "gateway_denial_spike",
        severity: "high",
        metricName: "denied_count",
        observedValue: 3,
        expectedValue: 0,
        recommendation: "Review denied profile scope.",
        evidenceQueryId: "query-123",
        evidenceWindowStart: "2026-05-20T00:00:00.000Z",
        evidenceWindowEnd: "2026-05-21T00:00:00.000Z",
        createdAt: "2026-05-21T01:00:00.000Z",
        status: "open",
      },
    ]);

    renderDashboard();

    const detail = await screen.findByLabelText(
      "Selected pipeline action detail",
    );

    expect(detail.textContent).toContain("Resolve event quality errors");
    expect(detail.textContent).toContain("2 quality errors need correction");
    expect(detail.textContent).toContain("missing required field: studentId");
    expect(
      screen
        .getByRole("link", { name: /Open service pipeline/i })
        .getAttribute("href"),
    ).toBe("/tribes/student-api?section=pipeline");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect pipeline action Gateway denials",
      }),
    );

    expect(
      screen.getByLabelText("Selected pipeline action detail").textContent,
    ).toContain("3 gateway decisions were denied");
  });
});
