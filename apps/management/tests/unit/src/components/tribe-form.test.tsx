import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TribeForm } from "@/components/tribe-form";
import { registerService } from "@/lib/api-center-client";
import { sharedServiceOptions } from "@/lib/service-form-presets";
import type { ServiceRegistryEntry } from "@/lib/schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-center-client", () => ({
  registerService: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const hyphenatedRootTribe: ServiceRegistryEntry = {
  serviceId: "smurf-village",
  name: "Smurf Village",
  baseUrl: "https://smurf-village.example.test",
  requiredScopes: ["smurf-village:read"],
  exposes: ["/health"],
  consumes: [],
  serviceType: "tribe",
  healthCheck: "/health",
  version: "1.0.0",
  tags: [],
  ownerTeam: "Smurf Village",
  contact: "owner@example.test",
  serviceTier: "standard",
  costCenter: "ENG",
  registeredAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  status: "active",
};

describe("TribeForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("defaults a hyphenated root tribe owner to the service ID when editing", () => {
    render(<TribeForm mode="edit" initialValue={hyphenatedRootTribe} />);

    expect((screen.getByLabelText("Owner tribe ID") as HTMLInputElement).value).toBe(
      "smurf-village",
    );
  });

  it("gives shared-service checkboxes explicit labels", () => {
    render(<TribeForm />);

    for (const option of sharedServiceOptions) {
      const checkbox = screen.getByLabelText(option.label) as HTMLInputElement;

      expect(checkbox.id).toBe(`sharedConsumes-${option.serviceId}`);
      expect(document.querySelector(`label[for="${checkbox.id}"]`)).toBeTruthy();
    }
  });

  it("lets operators add multiple service environments", async () => {
    vi.mocked(registerService).mockResolvedValue({
      serviceId: "trinithrive",
    } as ServiceRegistryEntry);

    render(<TribeForm />);

    fireEvent.change(screen.getByLabelText("Service ID"), {
      target: { value: "trinithrive" },
    });
    fireEvent.change(screen.getByLabelText("Service name"), {
      target: { value: "TriniThrive" },
    });
    fireEvent.change(screen.getByLabelText("Environment URL for test"), {
      target: { value: "https://trinithrive-test.example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
    fireEvent.change(screen.getByLabelText("Environment key for row 2"), {
      target: { value: "staging" },
    });
    fireEvent.change(screen.getByLabelText("Environment URL for staging"), {
      target: { value: "https://trinithrive-staging.example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Register service" }));

    await waitFor(() =>
      expect(registerService).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://trinithrive-test.example.com",
          environments: [
            expect.objectContaining({
              environment: "test",
              baseUrl: "https://trinithrive-test.example.com",
            }),
            expect.objectContaining({
              environment: "staging",
              baseUrl: "https://trinithrive-staging.example.com",
            }),
          ],
        }),
      ),
    );
  });
});
