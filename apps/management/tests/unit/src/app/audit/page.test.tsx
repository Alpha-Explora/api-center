import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuditPage from "../../../../../src/app/(management)/audit/page";

vi.mock("@/components/audit-log-client", () => ({
  AuditLogClient: ({
    defaultActionFamily,
    defaultServiceId,
  }: {
    defaultActionFamily?: string;
    defaultServiceId?: string;
  }) => (
    <section>
      Audit filters: {defaultServiceId} / {defaultActionFamily}
    </section>
  ),
}));

describe("AuditPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("passes service and action family filters from the route", async () => {
    render(
      await AuditPage({
        searchParams: Promise.resolve({
          serviceId: "logistics-orders",
          actionFamily: "approval",
        }),
      }),
    );

    expect(
      screen.getByText("Audit filters: logistics-orders / approval"),
    ).toBeTruthy();
  });
});
