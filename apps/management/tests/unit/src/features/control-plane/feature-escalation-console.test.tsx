import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api-center/client-core";
import { ApprovalsPage } from "@/features/control-plane/views/approvals/approvals-page";
import { PlanPicker } from "@/features/control-plane/views/quotas/plan-picker";
import { PayoutPausePanel } from "@/features/control-plane/views/settings/payout-controls";
import { SmsSenderSheet } from "@/features/control-plane/views/capabilities/sms-sender-sheet";

const featureAccess = vi.hoisted(() => ({
  list: vi.fn(), request: vi.fn(), cancel: vi.fn(), decide: vi.fn(), pauses: vi.fn(), setPause: vi.fn(),
  operators: vi.fn(), changeOperator: vi.fn(), projectSwitch: vi.fn(), setProjectSwitch: vi.fn(),
}));
const controlPlane = vi.hoisted(() => ({ plans: vi.fn(), plan: vi.fn(), assignPlan: vi.fn() }));
const capabilityConfiguration = vi.hoisted(() => ({ smsSender: vi.fn(), saveSmsSender: vi.fn(), clearSmsSender: vi.fn() }));
const environment = vi.hoisted(() => ({ kind: "test" as "test" | "live" }));
const approvals = vi.hoisted(() => ({ items: [] as unknown[] }));
const organization = vi.hoisted(() => ({ platformAdmin: true }));

vi.mock("@/features/control-plane/data/features", () => ({ featureAccess }));
vi.mock("@/features/control-plane/data/control-plane-repository", () => ({ controlPlane }));
vi.mock("@/features/control-plane/data/capability-configuration", () => ({ capabilityConfiguration }));
vi.mock("@/features/control-plane/view-models/approvals", () => ({
  useApprovals: () => ({ data: approvals.items, isPending: false, error: null }),
}));
vi.mock("@/features/control-plane/view-models/use-organization", () => ({
  useOrganization: () => ({ organizationId: "org_1", platformAdmin: organization.platformAdmin, setOrganizationId: vi.fn(),
    loading: false, session: { email: "operator@example.test" } }),
}));
vi.mock("@/features/control-plane/view-models/project-environment", () => ({
  useProjectEnvironment: () => ({ organizationId: "org_1", project: { id: "prj_1", name: "Marketplace" }, kind: environment.kind,
    canWrite: true, canManage: true }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const smsRequest = {
  id: "frq_aaaaaaaaaaaaaaaaaaaaaaaa", kind: "feature", organizationId: "org_1", organizationName: "Alpha", projectId: "prj_1",
  projectName: "Marketplace", summary: "Pin sender ID MYSHOP", requestedBy: "dev@example.test", requestedAt: "2026-11-24T00:00:00Z",
  requestedByYou: false, feature: "sms.sender", title: "SMS sender ID", change: { senderId: "MYSHOP" }, reason: "Brand our texts",
  environmentKind: "live", decidedBy: "platform", ageHours: 30,
};

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  environment.kind = "test";
  organization.platformAdmin = true;
  approvals.items = [smsRequest];
  featureAccess.list.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("approvals page feature requests", () => {
  it("lets an operator reject with a reason and approve", async () => {
    featureAccess.decide.mockResolvedValue({});
    renderWith(<ApprovalsPage />);
    expect(screen.getByText("Waiting 1 day")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    let dialog = within(await screen.findByRole("dialog"));
    const reject = dialog.getByRole("button", { name: "Reject request" });
    expect(reject.hasAttribute("disabled")).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Sender ID not registered" } });
    fireEvent.click(reject);
    await waitFor(() => expect(featureAccess.decide).toHaveBeenCalledWith(smsRequest.id, { approve: false, note: "Sender ID not registered" }));

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Pin sender ID MYSHOP")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(featureAccess.decide).toHaveBeenCalledWith(smsRequest.id, { approve: true }));
  });

  it("shows an organization owner that APICenter decides, with no decision buttons", () => {
    organization.platformAdmin = false;
    renderWith(<ApprovalsPage />);
    expect(screen.getByText("Waiting for APICenter")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});

describe("plan picker", () => {
  it("turns a refused upgrade into a request for that plan", async () => {
    controlPlane.plans.mockResolvedValue([
      { planKey: "standard", displayName: "Standard", requestsPerDay: 25_000, liveAllowed: true },
      { planKey: "enterprise", displayName: "Enterprise", requestsPerDay: null, liveAllowed: true },
    ]);
    controlPlane.plan.mockResolvedValue({ planKey: "standard" });
    controlPlane.assignPlan.mockRejectedValue(new ApiError("Pro or Enterprise plan needs approval from APICenter. Request it in the console.",
      403, "FEATURE_APPROVAL_REQUIRED", undefined, { feature: "plan.upgrade" }));
    featureAccess.request.mockResolvedValue({});
    renderWith(<PlanPicker />);

    const select = await screen.findByRole("combobox", { name: "Test plan" });
    await screen.findByRole("option", { name: /Enterprise/ });
    fireEvent.change(select, { target: { value: "enterprise" } });
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Launch traffic" } });
    fireEvent.click(dialog.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(featureAccess.request).toHaveBeenCalledWith(
      { organizationId: "org_1", projectId: "prj_1", kind: "test" },
      { feature: "plan.upgrade", change: { planKey: "enterprise" }, reason: "Launch traffic" },
    ));
  });
});

describe("payout pause panel", () => {
  it("needs a reason to pause and sends it", async () => {
    featureAccess.pauses.mockImplementation(async () => [
      { feature: "payouts_sending", paused: false, reason: null, updatedBy: null, updatedAt: null },
    ]);
    featureAccess.setPause.mockResolvedValue({});
    renderWith(<PayoutPausePanel />);

    const live = within(await screen.findByRole("region", { name: "live payout features" }));
    fireEvent.click(await live.findByRole("button", { name: "Pause" }));
    const dialog = within(await screen.findByRole("dialog"));
    const pause = dialog.getByRole("button", { name: "Pause feature" });
    expect(pause.hasAttribute("disabled")).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Provider incident" } });
    fireEvent.click(pause);
    await waitFor(() => expect(featureAccess.setPause).toHaveBeenCalledWith("live", "payouts_sending", true, "Provider incident"));
  });
});

describe("SMS sender sheet", () => {
  it("turns a refused live sender into a request for that sender", async () => {
    environment.kind = "live";
    capabilityConfiguration.smsSender.mockResolvedValue({ configured: false, senderId: null, platformSenderConfigured: true });
    capabilityConfiguration.saveSmsSender.mockRejectedValue(new ApiError("SMS sender ID needs approval from APICenter. Request it in the console.",
      403, "FEATURE_APPROVAL_REQUIRED", undefined, { feature: "sms.sender" }));
    featureAccess.request.mockResolvedValue({});
    renderWith(<SmsSenderSheet open onOpenChange={() => undefined} />);

    fireEvent.change(await screen.findByLabelText("Sender ID"), { target: { value: "MYSHOP" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin sender" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Pin the live SMS sender for Marketplace" }));
    fireEvent.click(confirm.getByRole("button", { name: "Pin sender" }));
    const send = await screen.findByRole("button", { name: "Send request" });
    const dialog = within(send.closest("[role=dialog]") as HTMLElement);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Brand our texts" } });
    fireEvent.click(dialog.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(featureAccess.request).toHaveBeenCalledWith(
      { organizationId: "org_1", projectId: "prj_1", kind: "live" },
      { feature: "sms.sender", change: { senderId: "MYSHOP" }, reason: "Brand our texts" },
    ));
  });
});
