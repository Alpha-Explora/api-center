import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TribeOnboardingPacketPanel } from "../../../../src/components/tribe-onboarding-packet-panel";
import type { ServiceRegistryEntry } from "@/lib/schemas";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const service: ServiceRegistryEntry = {
  serviceId: "pakiapps",
  name: "PakiApps",
  version: "1.0.0",
  baseUrl: "https://pakiapps.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "PakiApps",
  contact: "ops@pakiapps.example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["gauth"],
  exposes: ["/health"],
  requiredScopes: ["shared:gauth:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

describe("TribeOnboardingPacketPanel", () => {
  it("renders tribe handoff sections", () => {
    render(<TribeOnboardingPacketPanel service={service} />);

    expect(screen.getByText("Platform does")).toBeTruthy();
    expect(screen.getByText("Tribe does")).toBeTruthy();
    expect(screen.getByText("NestJS module")).toBeTruthy();
    expect(screen.getByText("Developer portal packet")).toBeTruthy();
    expect(
      screen.getByText("Install SDK: npm install @implementsprint/sdk"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "API Center base URL: https://api-center.itsandbox.site",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Allowed services: gauth")).toBeTruthy();
    expect(
      screen.getByText("Required scopes: shared:gauth:invoke"),
    ).toBeTruthy();
    expect(screen.getByText("Publish tribe event")).toBeTruthy();
    expect(screen.getByText("Publish custom event")).toBeTruthy();
    expect(screen.getByText(/APICENTER_TRIBE_ID=pakiapps/)).toBeTruthy();
    expect(
      screen.getAllByText(/tribe\.pakiapps\.events/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Copy Platform does" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy Server env vars" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy S3 export topic" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy Publish custom event" }),
    ).toBeTruthy();
  });
});
