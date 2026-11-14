import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuditPage from "../../../../../src/app/(management)/audit/page";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{await AuditPage({
        searchParams: Promise.resolve({
          serviceId: "logistics-orders",
          actionFamily: "approval",
        }),
      })}</QueryClientProvider>,
    );

    expect(
      screen.getByText("Audit filters: logistics-orders / approval"),
    ).toBeTruthy();
  });
});
