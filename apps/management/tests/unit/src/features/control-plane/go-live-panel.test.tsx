import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api-center/client-core";
import { GoLivePanel } from "@/features/control-plane/views/overview/go-live-panel";

const repository = vi.hoisted(() => ({
  liveReadiness: vi.fn(),
  activationRequests: vi.fn(),
  decideActivation: vi.fn(),
  requestActivation: vi.fn(),
  activateLive: vi.fn(),
  provisionLive: vi.fn(),
}));

vi.mock("@/features/control-plane/data/control-plane-repository", () => ({ controlPlane: repository }));
vi.mock("@/features/control-plane/view-models/project-environment", () => ({
  useProjectEnvironment: () => ({
    organizationId: "org_1",
    project: { id: "prj_1", name: "Serbizio" },
    environment: { kind: "live", status: "provisioning" },
    canManage: true,
  }),
}));
vi.mock("@/features/control-plane/view-models/use-organization", () => ({
  useOrganization: () => ({ session: { email: "approver@example.test" } }),
}));

const pending = {
  id: "5da56f89-47e1-490d-adbc-ddaed9490891",
  status: "pending",
  reason: "Serbizio production launch",
  requestedBy: "requester@example.test",
  createdAt: "2026-11-18T08:00:00Z",
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <GoLivePanel />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("GoLivePanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an approval at once even when the refresh after it fails", async () => {
    repository.liveReadiness.mockResolvedValue({ environmentId: "env_l", status: "provisioning", ready: true, checks: [] });
    repository.activationRequests
      .mockResolvedValueOnce([pending])
      .mockRejectedValue(new ApiError("APICenter is busy. Retry shortly.", 503, "DATABASE_BUSY"));
    repository.decideActivation.mockResolvedValue({ ...pending, status: "approved", approvedBy: "approver@example.test" });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByText("Approved")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: /Activate live/ })).toBeTruthy();
  });

  it("puts Activate live up front once it is ready, and confirms before activating", async () => {
    const checks = [
      { key: "plan", passed: true, detail: "Standard plan" },
      { key: "grant", passed: true, detail: "1 action granted in live" },
    ];
    repository.liveReadiness.mockResolvedValue({ environmentId: "env_l", status: "provisioning", ready: true, checks });
    repository.activationRequests.mockResolvedValue([{ ...pending, status: "approved", approvedBy: "approver@example.test" }]);
    repository.activateLive.mockResolvedValue({});

    renderPanel();

    expect(await screen.findByText("Ready to go live")).toBeTruthy();
    expect(screen.getByText("2 of 2 checks pass")).toBeTruthy();
    expect(screen.getByText("Approved by approver@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Activate live/ }));
    expect(repository.activateLive).not.toHaveBeenCalled();
    expect(await screen.findByText("Activate live for Serbizio")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Activate live" }).at(-1) as HTMLElement);
    await waitFor(() => expect(repository.activateLive).toHaveBeenCalledWith("org_1", "prj_1", pending.id));
  });

  it("does not offer a new activation request while existing requests are unknown", async () => {
    repository.liveReadiness.mockResolvedValue({ environmentId: "env_l", status: "provisioning", ready: true, checks: [] });
    repository.activationRequests.mockRejectedValue(new ApiError("APICenter is busy. Retry shortly.", 503, "DATABASE_BUSY"));

    renderPanel();

    await waitFor(() => expect(screen.getByText("Activation requests are unavailable")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Request activation" })).toBeNull();
  });

  it("says readiness is unknown rather than failed when it cannot be checked", async () => {
    repository.liveReadiness.mockRejectedValue(new ApiError("APICenter is busy. Retry shortly.", 503, "DATABASE_BUSY"));
    repository.activationRequests.mockResolvedValue([]);

    renderPanel();

    await waitFor(() => expect(screen.getByText("Readiness is unavailable")).toBeTruthy());
    const disabledRequest = screen.getByRole("button", { name: "Request activation" });
    fireEvent.focus(disabledRequest.parentElement as HTMLElement);
    expect(await screen.findByText("Readiness could not be checked. Try again in a moment.")).toBeTruthy();
    expect(screen.queryByText("Every readiness check must pass first.")).toBeNull();
  });
});
