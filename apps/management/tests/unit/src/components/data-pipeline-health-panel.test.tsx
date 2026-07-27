import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataPipelineHealthPanel } from "../../../../src/components/data-pipeline-health-panel";

describe("DataPipelineHealthPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading state", () => {
    render(<DataPipelineHealthPanel loading />);

    expect(screen.getByText("Loading pipeline health")).toBeTruthy();
  });

  it("shows an empty state when no rows are available", () => {
    render(<DataPipelineHealthPanel rows={[]} />);

    expect(screen.getByText("No pipeline health rows yet")).toBeTruthy();
  });

  it("warns when only test data is present", () => {
    render(
      <DataPipelineHealthPanel
        now={new Date("2026-05-20T11:00:00.000Z")}
        rows={[
          {
            environment: "test",
            tribeId: "codex-sdk-20260520041053",
            sourceServiceId: "codex-sdk-20260520041053-api",
            eventType: "codex.pipeline.flush",
            eventDay: "2026-05-20",
            eventCount: 1000,
            latestOccurredAt: "2026-05-20T09:41:45.721Z",
            latestIngestedAt: "2026-05-20T09:42:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Test data only")).toBeTruthy();
    expect(screen.getByText("codex-sdk-20260520041053")).toBeTruthy();
    expect(screen.getByText("codex.pipeline.flush")).toBeTruthy();
  });

  it("renders prod pipeline health rows", () => {
    render(
      <DataPipelineHealthPanel
        now={new Date("2026-05-20T11:00:00.000Z")}
        rows={[
          {
            environment: "prod",
            tribeId: "payments",
            sourceServiceId: "payments-api",
            eventType: "payment.completed",
            eventDay: "2026-05-20",
            eventCount: 42,
            latestOccurredAt: "2026-05-20T10:12:00.000Z",
            latestIngestedAt: "2026-05-20T10:14:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("prod")).toBeTruthy();
    expect(screen.getByText("payments")).toBeTruthy();
    expect(screen.getByText("payments-api")).toBeTruthy();
    expect(screen.getByText("payment.completed")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("does not expose raw S3 evidence keys in the table", () => {
    render(
      <DataPipelineHealthPanel
        now={new Date("2026-05-20T19:00:00.000Z")}
        rows={[
          {
            environment: "prod",
            tribeId: "logistics",
            sourceServiceId: "logistics-orders",
            eventType: "order.created",
            eventDay: "2026-05-20",
            eventCount: 1000,
            latestOccurredAt: "2026-05-20T18:20:00.000Z",
            latestIngestedAt: "2026-05-20T18:21:00.000Z",
            latestS3ObjectKey:
              "s3://api-center-raw-data/topics/prod.tribe.logistics.events/year=2026/month=05/day=20/hour=18/file.json",
          },
        ]}
      />,
    );

    expect(
      screen.queryByText(/api-center-raw-data\/topics\/prod\.tribe\.logistics/),
    ).toBeNull();
  });

  it("warns when latest ingestion is stale", () => {
    render(
      <DataPipelineHealthPanel
        now={new Date("2026-05-21T12:00:00.000Z")}
        rows={[
          {
            environment: "prod",
            tribeId: "logistics",
            sourceServiceId: "logistics-api",
            eventType: "shipment.created",
            eventDay: "2026-05-20",
            eventCount: 3,
            latestOccurredAt: "2026-05-20T08:00:00.000Z",
            latestIngestedAt: "2026-05-20T08:05:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Stale ingestion")).toBeTruthy();
  });
});
