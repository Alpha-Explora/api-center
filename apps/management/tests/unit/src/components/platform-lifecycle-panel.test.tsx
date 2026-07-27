import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformLifecyclePanel } from "@/components/platform-lifecycle-panel";
import type { PlatformLifecycle } from "@/lib/service-lifecycle";
import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const services: ServiceRegistryEntry[] = [
  {
    serviceId: "campus-one",
    name: "Campus One",
    baseUrl: "https://campus-one.example.test",
    requiredScopes: ["campus:read"],
    exposes: ["/students"],
    consumes: ["missing-service"],
    ownerTribeId: "campus-one",
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Campus One",
    contact: "campus@example.test",
    serviceTier: "critical",
    costCenter: "CAMPUS",
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    status: "active",
    healthy: true,
    lastHealthCheckAt: "2026-06-14T00:00:00.000Z",
  },
  {
    serviceId: "payments",
    name: "Payments",
    baseUrl: "https://payments.example.test",
    requiredScopes: ["payments:write"],
    exposes: ["/checkout"],
    consumes: [],
    serviceType: "shared",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Payments",
    contact: "payments@example.test",
    serviceTier: "critical",
    costCenter: "PAY",
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    status: "active",
    healthy: true,
    lastHealthCheckAt: "2026-06-14T00:00:00.000Z",
  },
];

const quotaPolicies: QuotaPolicy[] = [
  {
    id: "campus-one-observe",
    ownerTribeId: "campus-one",
    scope: "all",
    targetServiceId: null,
    windowSeconds: 86400,
    maxRequests: 25000,
    burstRequests: null,
    mode: "observe",
    status: "active",
    reason: "Launch baseline",
    updatedAt: "2026-06-14T00:00:00.000Z",
  },
];

const quotaUsage: QuotaUsageDecision[] = [];

const sourceLifecycle: PlatformLifecycle = {
  generatedAt: "2026-06-15T00:00:00.000Z",
  summary: {
    total: 2,
    blocked: 1,
    attention: 0,
    ready: 1,
  },
  entries: [
    {
      service: services[0],
      ownerTribeId: "campus-one",
      status: "blocked",
      blockedCount: 1,
      attentionCount: 0,
      stages: [
        {
          id: "ownership",
          label: "Ownership",
          status: "blocked",
          evidence: "Missing owner team, contact.",
          source: "registry",
          action: "Update owner and contact fields in the manifest.",
          href: "/tribes/campus-one/edit",
        },
        {
          id: "pipeline",
          label: "Pipeline",
          status: "complete",
          evidence: "1 prod pipeline-health row is available.",
          source: "pipeline-health",
          action: "Review pipeline evidence.",
          href: "/tribes/campus-one?section=pipeline",
        },
      ],
      nextAction: {
        stageId: "ownership",
        label: "Update owner and contact fields in the manifest.",
        href: "/tribes/campus-one/edit",
      },
    },
    {
      service: services[1],
      ownerTribeId: "payments",
      status: "ready",
      blockedCount: 0,
      attentionCount: 0,
      stages: [
        {
          id: "promotion",
          label: "Promotion",
          status: "complete",
          evidence: "Approved request approval-1.",
          source: "approval-request",
          action: "Review live promotion gates.",
          href: "/promotions",
        },
      ],
      nextAction: {
        stageId: "registry",
        label: "Open the service detail record.",
        href: "/tribes/payments",
      },
    },
  ],
};

describe("PlatformLifecyclePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the lifecycle spine sorted by services needing action first", () => {
    render(
      <PlatformLifecyclePanel
        services={services}
        quotaPolicies={quotaPolicies}
        quotaUsage={quotaUsage}
      />,
    );

    expect(screen.getByText("Service lifecycle")).toBeTruthy();
    expect(screen.getByText("1 blocked")).toBeTruthy();
    expect(screen.getAllByText("Campus One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dependencies").length).toBeGreaterThan(0);
    const actionLink = screen.getAllByRole("link", {
      name: /Register the target service or remove the stale consume edge/i,
    })[0];
    expect(actionLink.getAttribute("href")).toBe(
      "/tribes/campus-one?section=dependencies",
    );
    expect(screen.getByText("Payments")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("renders an empty state when no services are registered", () => {
    render(
      <PlatformLifecyclePanel
        services={[]}
        quotaPolicies={[]}
        quotaUsage={[]}
      />,
    );

    expect(screen.getByText("No services registered")).toBeTruthy();
  });

  it("shows source evidence for the selected service and updates the detail rail", () => {
    render(<PlatformLifecyclePanel lifecycle={sourceLifecycle} />);

    expect(screen.getByLabelText("Selected service lifecycle detail")).toBeTruthy();
    expect(screen.getByText("Selected service")).toBeTruthy();
    expect(screen.getAllByText("Campus One").length).toBeGreaterThan(0);
    expect(screen.getByText("registry")).toBeTruthy();
    expect(screen.getByText("Missing owner team, contact.")).toBeTruthy();
    expect(screen.getByText("pipeline-health")).toBeTruthy();
    expect(
      screen.getByText("1 prod pipeline-health row is available."),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Campus One" })
        .every(
          (link) =>
            link.getAttribute("href") ===
            "/tribes/campus-one?section=governance",
        ),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect lifecycle for Payments",
      }),
    );

    expect(screen.getByText("approval-request")).toBeTruthy();
    expect(screen.getByText("Approved request approval-1.")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Selected service lifecycle detail"))
        .getByRole("link", { name: "Review live promotion gates." })
        .getAttribute("href"),
    ).toBe("/tribes/payments?section=governance");
    expect(
      screen.getByRole("button", {
        name: "Inspect lifecycle for Payments",
        pressed: true,
      }),
    ).toBeTruthy();
  });

  it("turns the selected service detail into a cross-product command map", () => {
    render(<PlatformLifecyclePanel lifecycle={sourceLifecycle} />);

    const detail = screen.getByLabelText("Selected service lifecycle detail");

    expect(detail.textContent).toContain("Command map");
    expect(detail.textContent).toContain("Fix now");
    expect(detail.textContent).toContain("Evidence ready");
    expect(detail.textContent).toContain("Ownership");
    expect(detail.textContent).toContain("Missing owner team, contact.");
    expect(detail.textContent).toContain("Pipeline");
    expect(detail.textContent).toContain("1 prod pipeline-health row is available.");
    expect(
      within(detail)
        .getByRole("link", {
          name: "Update owner and contact fields in the manifest.",
        })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one/edit");
    expect(
      within(detail)
        .getByRole("link", { name: "Review pipeline evidence." })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=pipeline");
  });
});
