import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationRequestsClient } from "@/components/registration-requests-client";

const apiClient = vi.hoisted(() => ({
  approveRegistrationRequest: vi.fn(),
  listRegistrationRequests: vi.fn(),
  rejectRegistrationRequest: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const pendingRequest = {
  id: "00000000-0000-0000-0000-000000000001",
  serviceId: "logistics-orders",
  ownerTribeId: "logistics",
  projectId: "logistics-core",
  status: "pending" as const,
  manifest: {
    serviceId: "logistics-orders",
    projectId: "logistics-core",
    name: "Logistics Orders",
    baseUrl: "https://orders.example.test",
    requiredScopes: ["orders:read"],
    exposes: ["/orders", "/health"],
    consumes: ["payment"],
    serviceType: "tribe" as const,
    version: "1.0.0",
    tags: [],
    serviceTier: "standard" as const,
  },
  validationReport: {
    canApply: true,
    issues: [],
  },
  requestedBy: "github:logistics/orders",
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};


const liveRequest = {
  ...pendingRequest,
  id: "00000000-0000-0000-0000-000000000003",
  manifest: {
    ...pendingRequest.manifest,
    environments: [
      {
        environment: "live" as const,
        baseUrl: "https://orders.example.test",
      },
    ],
  },
};
const blockedRequest = {
  ...pendingRequest,
  id: "00000000-0000-0000-0000-000000000002",
  serviceId: "payments-gateway",
  ownerTribeId: "payments",
  projectId: "payments-core",
  manifest: {
    ...pendingRequest.manifest,
    serviceId: "payments-gateway",
    projectId: "payments-core",
    name: "Payments Gateway",
    baseUrl: "https://payments.example.test",
    consumes: ["ledger"],
  },
  validationReport: {
    canApply: false,
    issues: [
      {
        code: "scope.invalid",
        severity: "blocking" as const,
        message: "Scope payments:write is not allowed.",
      },
    ],
  },
  requestedBy: "github:payments/gateway",
};

describe("RegistrationRequestsClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows pending request handoff values", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([pendingRequest]);

    renderWithClient(<RegistrationRequestsClient />);

    expect(
      (await screen.findAllByText("logistics-orders")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("project=logistics-core tribe=logistics")).toBeTruthy();
    expect(
      screen.getByText("APICENTER_SERVICE_ID=logistics-orders"),
    ).toBeTruthy();
    expect(screen.getByText("topic=tribe.logistics.events")).toBeTruthy();
  });

  it("uses one selected request review panel for evidence and actions", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([
      pendingRequest,
      blockedRequest,
    ]);

    renderWithClient(<RegistrationRequestsClient />);

    expect(
      await screen.findByLabelText("Selected registration request detail"),
    ).toBeTruthy();
    expect(screen.getByText("Review request")).toBeTruthy();
    expect(screen.getAllByText("payments-gateway").length).toBeGreaterThan(0);
    expect(screen.getByText("project=payments-core tribe=payments")).toBeTruthy();
    expect(
      screen.getByText("blocking: Scope payments:write is not allowed."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect registration request for logistics-orders",
      }),
    );

    expect(screen.getAllByText("logistics-orders").length).toBeGreaterThan(0);
    expect(screen.getByText("project=logistics-core tribe=logistics")).toBeTruthy();
    expect(
      screen.getByLabelText("Rejection reason for logistics-orders"),
    ).toBeTruthy();
  });

  it("shows the request path across portal, service detail, promotions, and audit", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([pendingRequest]);

    renderWithClient(<RegistrationRequestsClient />);

    const requestPath = await screen.findByLabelText("Registration request path");

    expect(requestPath.textContent).toContain("Portal preview");
    expect(requestPath.textContent).toContain("Service detail");
    expect(requestPath.textContent).toContain("Promotion gates");
    expect(requestPath.textContent).toContain("Audit trail");
    expect(
      screen
        .getByRole("link", { name: "Open portal preview" })
        .getAttribute("href"),
    ).toBe("/developer-portal?tribeId=logistics");
    expect(
      screen
        .getByRole("link", { name: "Open service detail" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=summary");
    expect(
      screen
        .getByRole("link", { name: "Open promotion gates" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=governance");
    expect(
      screen
        .getByRole("link", { name: "Open audit trail" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=evidence");
  });

  it("requires review before approving a pending request", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([pendingRequest]);
    apiClient.approveRegistrationRequest.mockResolvedValue({
      ...pendingRequest,
      status: "applied",
    });

    renderWithClient(<RegistrationRequestsClient />);

    const approveButton = await screen.findByRole("button", {
      name: /approve request/i,
    }, { timeout: 5000 });
    expect((approveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/reviewed this manifest/i));
    await waitFor(() =>
      expect((approveButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(approveButton);

    await waitFor(() =>
      expect(apiClient.approveRegistrationRequest).toHaveBeenCalledWith(
        pendingRequest.id,
      ),
    );
  });


  it("requires live confirmation phrase and reason before approving a live request", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([liveRequest]);
    apiClient.approveRegistrationRequest.mockResolvedValue({
      ...liveRequest,
      status: "applied",
    });

    renderWithClient(<RegistrationRequestsClient />);

    expect(await screen.findByText("Live registry approval")).toBeTruthy();
    const approveButton = screen.getByRole("button", {
      name: /approve request/i,
    });

    fireEvent.click(screen.getByLabelText(/reviewed this manifest/i));
    expect((approveButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(
      screen.getByLabelText("Live approval phrase for logistics-orders"),
      { target: { value: "APPLY LIVE CHANGE" } },
    );
    fireEvent.change(
      screen.getByLabelText("Live approval reason for logistics-orders"),
      { target: { value: "Approved Spark Site live route" } },
    );

    await waitFor(() =>
      expect((approveButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(approveButton);

    await waitFor(() =>
      expect(apiClient.approveRegistrationRequest).toHaveBeenCalledWith(
        liveRequest.id,
        {
          typedPhrase: "APPLY LIVE CHANGE",
          reason: "Approved Spark Site live route",
        },
      ),
    );
  });
  it("requires a rejection reason before rejecting", async () => {
    apiClient.listRegistrationRequests.mockResolvedValue([pendingRequest]);
    renderWithClient(<RegistrationRequestsClient />);

    const rejectButton = await screen.findByRole("button", { name: /reject/i });
    expect((rejectButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/reason/i), {
      target: { value: "Consumes list not approved." },
    });

    await waitFor(() =>
      expect((rejectButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(rejectButton);

    await waitFor(() =>
      expect(apiClient.rejectRegistrationRequest).toHaveBeenCalledWith(
        pendingRequest.id,
        "Consumes list not approved.",
      ),
    );
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
