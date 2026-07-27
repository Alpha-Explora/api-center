import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawToSilverRunPanel } from "../../../../src/components/raw-to-silver-run-panel";

const apiClient = vi.hoisted(() => ({
  previewRawToSilverRun: vi.fn(),
  startRawToSilverRun: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("sonner", () => ({
  toast: toastMock,
}));

describe("RawToSilverRunPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("previews and starts a tribe-scoped raw to Common Silver run", async () => {
    apiClient.previewRawToSilverRun.mockResolvedValue({
      status: "preview",
      environment: "test",
      tribeId: "greenovate",
      physicalTopic: "test.tribe.greenovate.events",
      partition: { year: "2026", month: "05", day: "22" },
      startedAt: "2026-05-23T01:00:00.000Z",
      raw: {},
      bronze: {},
      commonSilver: {},
      materialization: {
        requested: true,
        targetDatabase: "materialized_platform",
        targetTable:
          "materialized_platform.common_silver_tribe_event_envelope_greenovate_test_20260522",
        externalLocation:
          "s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/tribe_id=greenovate/environment=test/year=2026/month=05/day=22/",
      },
      previewQueries: {
        raw: "SELECT COUNT(*)",
        bronze: "SELECT COUNT(*)",
        commonSilver: "SELECT COUNT(*)",
      },
    });
    apiClient.startRawToSilverRun.mockResolvedValue({
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
    });

    render(
      <RawToSilverRunPanel
        environment="test"
        partition={{ year: "2026", month: "05", day: "22" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Tribe ID"), {
      target: { value: "greenovate" },
    });
    const startButton = screen.getByRole("button", {
      name: "Start Raw to Silver",
    }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    expect(screen.getByText(/preview required/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview Raw to Silver" }));

    await waitFor(() =>
      expect(apiClient.previewRawToSilverRun).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: "test",
          tribeId: "greenovate",
          year: "2026",
          month: "05",
          day: "22",
          materialize: true,
        }),
      ),
    );
    expect(await screen.findByText("test.tribe.greenovate.events")).toBeTruthy();

    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(apiClient.startRawToSilverRun).toHaveBeenCalledWith(
        expect.objectContaining({ tribeId: "greenovate" }),
      ),
    );
    expect(await screen.findByText("Common Silver rows")).toBeTruthy();
    expect(screen.getAllByText("8").length).toBeGreaterThan(0);
  });
});
