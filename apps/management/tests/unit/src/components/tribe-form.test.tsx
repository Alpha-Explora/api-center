import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeForm } from "@/components/tribe-form";
import { listTribes, registerService } from "@/lib/api-center-client";
import { sharedServiceOptions } from "@/lib/service-form-presets";
import type { ServiceRegistryEntry, TenancyTribe } from "@/lib/schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-center-client", () => ({
  listTribes: vi.fn(),
  registerService: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const smurfTribe: TenancyTribe = {
  tribeId: "smurf-village",
  name: "Smurf Village",
  status: "active",
  createdAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  projects: [
    {
      projectId: "smurf-village-default",
      tribeId: "smurf-village",
      name: "Default",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    },
    {
      projectId: "smurf-village-mushrooms",
      tribeId: "smurf-village",
      name: "Mushrooms",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    },
  ],
};

const registeredService: ServiceRegistryEntry = {
  serviceId: "smurf-village",
  projectId: "smurf-village-default",
  ownerTribeId: "smurf-village",
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
  beforeEach(() => {
    vi.mocked(listTribes).mockResolvedValue([smurfTribe]);
  });

  afterEach(() => {
    cleanup();
  });

  it("locks a registered service to its project when editing", async () => {
    renderWithClient(<TribeForm mode="edit" initialValue={registeredService} />);

    expect(
      await screen.findByRole("option", { name: /smurf-village-default/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /smurf-village-mushrooms/ })).toBeNull();
    expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe(
      "smurf-village-default",
    );
  });

  it("gives shared-service checkboxes explicit labels", () => {
    renderWithClient(<TribeForm />);

    for (const option of sharedServiceOptions) {
      const checkbox = screen.getByLabelText(option.label) as HTMLInputElement;

      expect(checkbox.id).toBe(`sharedConsumes-${option.serviceId}`);
      expect(document.querySelector(`label[for="${checkbox.id}"]`)).toBeTruthy();
    }
  });

  it("registers a service into the chosen project with multiple environments", async () => {
    vi.mocked(registerService).mockResolvedValue({
      serviceId: "trinithrive",
    } as ServiceRegistryEntry);

    renderWithClient(<TribeForm />);

    await screen.findByRole("option", { name: /smurf-village-mushrooms/ });
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "smurf-village-mushrooms" },
    });
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
          projectId: "smurf-village-mushrooms",
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
    expect(vi.mocked(registerService).mock.calls[0]?.[0]).not.toHaveProperty(
      "ownerTribeId",
    );
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
