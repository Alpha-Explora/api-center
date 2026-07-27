import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManifestToolsClient } from "@/components/manifest-tools-client";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  listServices: vi.fn(),
  registerService: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("@/lib/client-clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const ownerTribe: ServiceRegistryEntry = {
  serviceId: "logistics",
  ownerTribeId: "logistics",
  name: "Logistics",
  baseUrl: "https://logistics.example.test",
  requiredScopes: ["logistics:read"],
  exposes: ["/health"],
  consumes: [],
  serviceType: "tribe",
  version: "1.0.0",
  tags: [],
  serviceTier: "standard",
  registeredAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  status: "active",
};

describe("ManifestToolsClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows owner tribe handoff and event topic for a microservice import", async () => {
    apiClient.listServices.mockResolvedValue([ownerTribe]);
    renderWithClient(<ManifestToolsClient />);

    await waitFor(() =>
      expect(
        (screen.getAllByRole("textbox")[0] as HTMLTextAreaElement).value,
      ).toContain("logistics"),
      { timeout: 5000 },
    );

    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: {
        value: JSON.stringify({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
          consumes: [],
          serviceType: "tribe",
        }),
      },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /validate/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /validate/i }));

    expect(await screen.findByText(/Registration plan is applicable/i)).toBeTruthy();
    expect(screen.getByText("APICENTER_TRIBE_ID=logistics")).toBeTruthy();
    expect(screen.getByText("APICENTER_SERVICE_ID=logistics-orders")).toBeTruthy();
    expect(screen.getByText("topic=tribe.logistics.events")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: /import manifests/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText(/reviewed the dry run/i));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", {
          name: /import manifests/i,
        }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("labels export and import manifest textareas", async () => {
    apiClient.listServices.mockResolvedValue([ownerTribe]);
    renderWithClient(<ManifestToolsClient />);

    expect(await screen.findByLabelText("Registry export JSON")).toBeTruthy();
    expect(screen.getByLabelText("Manifest import JSON")).toBeTruthy();
  });

  it("blocks import when the owner tribe is missing", async () => {
    apiClient.listServices.mockResolvedValue([]);
    renderWithClient(<ManifestToolsClient />);

    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: {
        value: JSON.stringify({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
          consumes: [],
          serviceType: "tribe",
        }),
      },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /validate/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /validate/i }));

    expect(await screen.findByText(/Registration plan is blocked/i)).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", {
          name: /import manifests/i,
        }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it("prepares legacy registry entries for ownerTribeId migration", async () => {
    apiClient.listServices.mockResolvedValue([
      ownerTribe,
      {
        ...ownerTribe,
        serviceId: "logistics-orders",
        ownerTribeId: undefined,
        name: "Logistics Orders",
      },
    ]);
    renderWithClient(<ManifestToolsClient />);

    await waitFor(() =>
      expect(
        (screen.getAllByRole("textbox")[0] as HTMLTextAreaElement).value,
      ).toContain("logistics-orders"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /prepare owner migration/i }),
    );

    const importInput = screen.getAllByRole("textbox")[1] as HTMLTextAreaElement;
    expect(importInput.value).toContain('"serviceId": "logistics-orders"');
    expect(importInput.value).toContain('"ownerTribeId": "logistics"');
    expect(
      await screen.findByText(/manifest\(s\) prepared with ownerTribeId/i),
    ).toBeTruthy();
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
