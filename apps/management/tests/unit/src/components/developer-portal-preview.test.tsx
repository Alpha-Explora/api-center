import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeveloperPortalPreview } from "@/components/developer-portal-preview";

const apiClient = vi.hoisted(() => ({
  getApiCenterBaseUrl: vi.fn(),
  listQuotaPolicies: vi.fn(),
  listServices: vi.fn(),
  requestQuotaIncrease: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const portalServices = [
  {
    serviceId: "campus-one",
    projectId: "campus-one-default",
    ownerTribeId: "campus-one",
    name: "Campus One",
    baseUrl: "https://campus-one.internal",
    requiredScopes: ["campus:read"],
    exposes: ["/students"],
    consumes: ["payment-service"],
    serviceType: "tribe",
    contact: "campus-ops@example.com",
    status: "active",
    registeredAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
  },
  {
    serviceId: "payment-service",
    name: "Payments",
    baseUrl: "https://payments.internal",
    requiredScopes: ["payments:write"],
    exposes: ["/checkout"],
    consumes: [],
    serviceType: "shared",
    status: "active",
    registeredAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
  },
];

const portalQuotaPolicies = [
  {
    id: "quota-1",
    ownerTribeId: "campus-one",
    scope: "all",
    targetServiceId: null,
    windowSeconds: 86400,
    maxRequests: 25000,
    burstRequests: null,
    mode: "observe",
    status: "active",
    reason: "Plan default",
    updatedAt: "2026-05-25T00:00:00.000Z",
  },
];

function stubPortalFetch({
  tribeId = "campus-one",
  services = portalServices,
  quotaPolicies = portalQuotaPolicies,
}: {
  tribeId?: string;
  services?: typeof portalServices;
  quotaPolicies?: typeof portalQuotaPolicies;
} = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          tribeId,
          services,
          quotaPolicies,
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

vi.mock("@/lib/api-center-client", () => apiClient);
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("DeveloperPortalPreview", () => {
  beforeEach(() => {
    vi.useRealTimers();
    apiClient.getApiCenterBaseUrl.mockReturnValue(
      "https://api-center.itsandbox.site",
    );
    apiClient.listServices.mockResolvedValue([
      {
        serviceId: "campus-one",
        projectId: "campus-one-default",
        ownerTribeId: "campus-one",
        name: "Campus One",
        baseUrl: "https://campus-one.internal",
        requiredScopes: ["campus:read"],
        exposes: ["/students"],
        consumes: ["payment-service"],
        serviceType: "tribe",
        contact: "campus-ops@example.com",
        status: "active",
        registeredAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      {
        serviceId: "payment-service",
        name: "Payments",
        baseUrl: "https://payments.internal",
        requiredScopes: ["payments:write"],
        exposes: ["/checkout"],
        consumes: [],
        serviceType: "shared",
        status: "active",
        registeredAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
    apiClient.listQuotaPolicies.mockResolvedValue([
      {
        id: "quota-1",
        ownerTribeId: "campus-one",
        scope: "all",
        targetServiceId: null,
        windowSeconds: 86400,
        maxRequests: 25000,
        burstRequests: null,
        mode: "observe",
        status: "active",
        reason: "Plan default",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
    apiClient.requestQuotaIncrease.mockResolvedValue({
      id: "approval-1",
      actionType: "quota.increase",
      status: "pending",
    });
    stubPortalFetch();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders tribe-safe portal data and docs links", async () => {
    renderWithClient(<DeveloperPortalPreview initialTribeId="campus-one" />);

    expect(await screen.findByText("campus-one")).toBeTruthy();
    expect(screen.getByText("https://api-center.itsandbox.site")).toBeTruthy();
    expect(screen.getByText("@alpha-explora/apicenter-sdk")).toBeTruthy();
    expect(screen.getByText("payment-service")).toBeTruthy();
    expect(screen.getByText("payments:write")).toBeTruthy();
    expect(screen.getByText("25,000 / 86400s")).toBeTruthy();
    expect(screen.getByText("tribe.campus-one.events")).toBeTruthy();
    expect(screen.getByText("campus-ops@example.com")).toBeTruthy();
    expect(screen.getByText("Lifecycle state")).toBeTruthy();
    expect(screen.getByText("Registered service")).toBeTruthy();
    expect(screen.getAllByText("Quota policy").length).toBeGreaterThan(0);
    expect(screen.queryByText(/internal/)).toBeNull();
    expect(screen.queryByText(/secret/i)).toBeNull();
    expect(
      screen.getByRole("link", { name: /open sdk runbook/i }),
    ).toBeTruthy();
    expect(screen.getByText("Request quota increase")).toBeTruthy();
  });

  it("loads developer portal data from the tribe-scoped endpoint", async () => {
    const fetchMock = stubPortalFetch({
      tribeId: "commerce",
      services: [],
      quotaPolicies: [],
    });

    renderWithClient(<DeveloperPortalPreview initialTribeId="commerce" />);

    await screen.findByText("commerce");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/developer-portal/commerce",
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/local/registry/services",
      expect.any(Object),
    );
  });


  it("prioritizes developer setup actions with one selected detail", async () => {
    renderWithClient(<DeveloperPortalPreview initialTribeId="campus-one" />);

    const detail = await screen.findByLabelText(
      "Selected developer portal action",
    );
    expect(detail.textContent).toContain("Resolve service setup blockers");
    expect(detail.textContent).toContain(
      "Campus One has 2 blocked and 2 attention lifecycle checks.",
    );
    expect(
      screen
        .getByRole("link", { name: /open service detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=governance");

    const quotaActionButton = screen.getByRole("button", {
      name: /inspect developer portal action quota request/i,
    });
    expect(quotaActionButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(quotaActionButton);

    expect(detail.textContent).toContain(
      "Active quota policy allows 25,000 requests per 86400s.",
    );
    expect(
      screen
        .getByRole("link", { name: /request quota increase/i })
        .getAttribute("href"),
    ).toBe("#developer-portal-quota-request");
    expect(quotaActionButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("routes missing quota setup into the tribe service detail", async () => {
    stubPortalFetch({ quotaPolicies: [] });

    renderWithClient(<DeveloperPortalPreview initialTribeId="campus-one" />);

    const quotaActionButton = await screen.findByRole("button", {
      name: /inspect developer portal action create quota policy/i,
    });
    fireEvent.click(quotaActionButton);

    expect(
      screen
        .getByRole("link", { name: /open quota policies/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=quotas");
  });

  it("refreshes the preview for another tribe id", async () => {
    const fetchMock = stubPortalFetch();

    renderWithClient(<DeveloperPortalPreview />);

    fireEvent.change(screen.getByLabelText("Tribe ID"), {
      target: { value: "campus-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview portal/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/local/developer-portal/campus-one",
        expect.any(Object),
      ),
    );
    expect(navigation.replace).toHaveBeenCalledWith(
      "/developer-portal?tribeId=campus-one",
      { scroll: false },
    );
  });

  it("shows a recovery path before a tribe is selected", () => {
    renderWithClient(<DeveloperPortalPreview />);

    expect(screen.getByText("Choose a tribe")).toBeTruthy();
    expect(screen.getByText("Recovery path")).toBeTruthy();
    expect(screen.getByText("Find the owner tribe ID")).toBeTruthy();
    expect(screen.getByText("Verify registry source data")).toBeTruthy();
    expect(screen.getByText("Preview the portal packet")).toBeTruthy();
  });

  it("submits quota increase requests for the previewed tribe", async () => {
    renderWithClient(<DeveloperPortalPreview initialTribeId="campus-one" />);

    expect(await screen.findByText("Request quota increase")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Requested max requests"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByLabelText("Request reason"), {
      target: { value: "Enrollment launch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() =>
      expect(apiClient.requestQuotaIncrease).toHaveBeenCalledWith(
        {
          ownerTribeId: "campus-one",
          requestedMaxRequests: 50000,
          reason: "Enrollment launch",
        },
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("Quota request submitted")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Review quota detail" })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=quotas");
    expect(
      screen
        .getByRole("link", { name: "Open evidence trail" })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=evidence");
  });

  it("shows a recoverable error when portal data requests hang", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    renderWithClient(<DeveloperPortalPreview initialTribeId="campus-one" />);

    expect(
      await screen.findByText("Could not load portal preview", undefined, {
        timeout: 5000,
      }),
    ).toBeTruthy();
  }, 8000);
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
