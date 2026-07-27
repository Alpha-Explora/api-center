import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SharedServiceProviderConfigHealthPanel,
  TribeSecretHealthPanel,
} from "../../../../src/components/secret-health-panel";

const apiClient = vi.hoisted(() => ({
  getSharedServiceSecretStatus: vi.fn(),
  getTribeSecretStatus: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("secret health panels", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders provider config metadata without secret values", async () => {
    apiClient.getSharedServiceSecretStatus.mockResolvedValue({
      sharedServices: [
        {
          serviceId: "payment",
          secretName: "api-shared-services-prod",
          exists: true,
          observedKeyNames: ["paymongo_secret_key"],
          missingKeyNames: ["paymongo_webhook_secret"],
          status: "missing",
        },
      ],
    });

    renderWithClient(<SharedServiceProviderConfigHealthPanel />);

    expect(await screen.findByText("payment")).toBeTruthy();
    expect(screen.getByText("paymongo_webhook_secret")).toBeTruthy();
    expect(screen.queryByText(/sk_live/)).toBeNull();
  });

  it("renders tribe secret metadata and rotation warnings", async () => {
    apiClient.getTribeSecretStatus.mockResolvedValue({
      serviceId: "flow-ci",
      secretId: "api-center-tribe-secret-flow-ci",
      expectedSecretId: "api-center-tribe-secret-flow-ci",
      exists: true,
      enabled: true,
      state: "ENABLED",
      latestEnabledVersion: "5",
      latestVersionCreatedAt: "2026-01-01T00:00:00.000Z",
      rotationWarning: {
        stale: true,
        severity: "warning",
        message: "Rotate this tribe secret.",
      },
    });

    renderWithClient(<TribeSecretHealthPanel serviceId="flow-ci" />);

    await waitFor(() =>
      expect(apiClient.getTribeSecretStatus).toHaveBeenCalledWith("flow-ci"),
    );
    expect(
      await screen.findByText("api-center-tribe-secret-flow-ci"),
    ).toBeTruthy();
    expect(screen.getByText("Version 5")).toBeTruthy();
    expect(screen.getByText("Rotate this tribe secret.")).toBeTruthy();
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
