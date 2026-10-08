import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SdkConfigPanel } from "../../../../src/components/sdk-config-panel";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const service: ServiceRegistryEntry = {
  serviceId: "trinithrive-api",
  projectId: "trinithrive-core",
  ownerTribeId: "trinithrive",
  name: "TriniThrive",
  version: "1.0.0",
  baseUrl: "https://trinithrive.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "TriniThrive",
  contact: "ops@trinithrive.example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["payment", "otp"],
  exposes: ["/orders", "/health"],
  requiredScopes: ["shared:payment:invoke", "shared:otp:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

describe("SdkConfigPanel", () => {
  it("renders NestJS setup, curated service examples, and contracts", () => {
    render(<SdkConfigPanel service={service} />);

    expect(screen.getByText("SDK package")).toBeTruthy();
    expect(screen.getByText("NestJS provider module")).toBeTruthy();
    expect(screen.getByText("Publish custom tribe event")).toBeTruthy();
    expect(screen.getByText("Shared-service SDK examples")).toBeTruthy();
    expect(screen.getByText("Google auth")).toBeTruthy();
    expect(screen.getByText("Payment")).toBeTruthy();
    expect(screen.getByText("OTP")).toBeTruthy();
    expect(screen.getByText("/api/v1/shared/payment/checkout/sessions")).toBeTruthy();
    expect(screen.getByText("paymongo.checkout.created")).toBeTruthy();
    expect(screen.getAllByText("Declared")).toHaveLength(2);
    expect(screen.getByText("/api/v1/tribes/trinithrive-api/orders")).toBeTruthy();
    expect(screen.getByText(/APICENTER_ENVIRONMENT=test/)).toBeTruthy();
    expect(screen.getByText(/APICENTER_ENVIRONMENT=live/)).toBeTruthy();
    expect(screen.getByText(/APICENTER_SERVICE_ID=trinithrive-api/)).toBeTruthy();
    expect(screen.queryByText(/APICENTER_TRIBE_ID/)).toBeNull();
    expect(screen.getByText(/APICENTER_SERVICE_ID=trinithrive-api/)).toBeTruthy();
    expect(screen.getByText(/<test-secret-issued-by-platform>/)).toBeTruthy();
    expect(screen.getByText(/<live-secret-issued-by-platform>/)).toBeTruthy();
  });
});
