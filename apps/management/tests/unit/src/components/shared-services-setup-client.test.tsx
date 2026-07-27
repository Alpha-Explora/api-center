import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedServicesSetupClient } from "@/components/shared-services-setup-client";

const apiClient = vi.hoisted(() => ({
  listServices: vi.fn(),
  registerService: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("SharedServicesSetupClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("labels the shared-service registration payload textarea", async () => {
    apiClient.listServices.mockResolvedValue([]);

    renderWithClient(<SharedServicesSetupClient />);

    expect(await screen.findByLabelText("Shared-service registration payload")).toBeTruthy();
  });

  it("requires review before registering selected shared services", async () => {
    apiClient.listServices.mockResolvedValue([]);
    apiClient.registerService.mockResolvedValue({});

    renderWithClient(<SharedServicesSetupClient />);

    await screen.findByLabelText("Shared-service registration payload");
    const registerButton = screen.getByRole("button", {
      name: /register selected/i,
    }) as HTMLButtonElement;
    expect(registerButton.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/reviewed selected shared-service manifests/i));
    await waitFor(() => expect(registerButton.disabled).toBe(false));
  });

  it("associates the shared-service setup review checkbox with an explicit label", async () => {
    apiClient.listServices.mockResolvedValue([]);

    const { container } = renderWithClient(<SharedServicesSetupClient />);

    await screen.findByLabelText("Shared-service registration payload");
    const checkbox = screen.getByLabelText(
      /reviewed selected shared-service manifests/i,
    ) as HTMLInputElement;

    expect(checkbox.id).toBe("shared-services-setup-reviewed");
    expect(
      container.querySelector('label[for="shared-services-setup-reviewed"]'),
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
