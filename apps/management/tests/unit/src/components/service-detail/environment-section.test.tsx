import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceEnvironmentPanel } from "../../../../../src/components/service-detail/environment-section";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const service: ServiceRegistryEntry = {
  serviceId: "spark-site",
  ownerTribeId: "church-donations",
  name: "Spark Site",
  version: "1.0.0",
  baseUrl: "https://spark-test.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "Alpha Explora",
  contact: "platform@example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["payment"],
  exposes: ["/donations"],
  requiredScopes: ["shared:payment:invoke"],
  status: "active",
  registeredAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  environments: [
    {
      environment: "test",
      baseUrl: "https://spark-test.example.com",
      healthCheck: "/healthz",
      status: "active",
      healthy: true,
      secretStatus: "secret ready",
      sharedServiceRouteStatus: "route ready",
      quotaPolicyStatus: "quota active",
      lastSmokeRunAt: "2026-06-27T01:00:00.000Z",
      promotionEvidenceStatus: "not required",
      breakGlassState: "inactive",
    },
    {
      environment: "live",
      baseUrl: "https://spark.example.com",
      healthCheck: "/ready",
      status: "active",
      healthy: false,
      secretStatus: "rotation pending",
      sharedServiceRouteStatus: "route approved",
      quotaPolicyStatus: "quota enforced",
      lastSmokeRunAt: "2026-06-27T02:00:00.000Z",
      promotionEvidenceStatus: "promotion bundle attached",
      breakGlassState: "disabled",
    },
  ],
};

describe("ServiceEnvironmentPanel", () => {
  it("shows environment-scoped operational evidence and target action guards", () => {
    render(<ServiceEnvironmentPanel service={service} />);

    expect(screen.getByText("https://spark-test.example.com")).toBeTruthy();
    expect(screen.getByText("https://spark.example.com")).toBeTruthy();
    expect(screen.getByText("secret ready")).toBeTruthy();
    expect(screen.getByText("route ready")).toBeTruthy();
    expect(screen.getByText("quota active")).toBeTruthy();
    expect(screen.getByText("promotion bundle attached")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
    expect(screen.getByText("standard write")).toBeTruthy();
    expect(screen.getByText("elevated live write")).toBeTruthy();

    expect(screen.getByText("unhealthy")).toBeTruthy();
    expect(
      screen.getByText("Live actions require phrase, reason, and audit evidence."),
    ).toBeTruthy();
  });
});