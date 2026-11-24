import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api-center/client-core";
import { PayoutsPage } from "@/features/control-plane/views/payouts/payouts-page";

const payouts = vi.hoisted(() => ({
  overview: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  payees: vi.fn(),
  payee: vi.fn(),
  list: vi.fn(),
  resolve: vi.fn(),
}));
const environment = vi.hoisted(() => ({ canWrite: true, platformAdmin: true }));

vi.mock("@/features/control-plane/data/payouts", () => ({ payouts }));
vi.mock("@/features/control-plane/view-models/use-organization", () => ({ useOrganization: () => ({ platformAdmin: environment.platformAdmin }) }));
vi.mock("@/features/control-plane/view-models/project-environment", () => ({
  RequireEnvironment: ({ children }: { children: React.ReactNode }) => children,
  useProjectEnvironment: () => ({ organizationId: "org_1", project: { id: "prj_1", name: "Marketplace" }, kind: "test", canWrite: environment.canWrite }),
}));

const policy = { schedule: { weekday: 5, hour: 20 }, immediate: false, thresholdCentavos: null, onDemand: { minimum: 10_000, dailyCap: 1_000_000 },
  feeBearer: { scheduled: "platform", cashOut: "payee" }, minimumPayout: 0, transferFee: 1_000 };
const stuck = { id: "po_ab12", payeeId: "pye_1", gross: 72_500, fee: 1_000, net: 72_500, trigger: "schedule", status: "needs_review",
  failureCode: null, createdAt: "2026-11-27T12:05:00Z" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PayoutsPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("PayoutsPage", () => {
  beforeEach(() => {
    environment.canWrite = true;
    environment.platformAdmin = true;
    payouts.overview.mockResolvedValue({ wallet: { configured: true, available: 1_250_000, lowFloatAlert: 100_000 }, counts: { needs_review: 1 },
      needsReview: [stuck], nextScheduledAt: "2026-11-27T12:00:00Z" });
    payouts.settings.mockResolvedValue(policy);
    payouts.payees.mockResolvedValue({ records: [{ id: "pye_1", externalRef: "PROVIDER-0042", legalName: "Juan Dela Cruz", status: "active",
      destination: { type: "instapay", bic: "GXCHPHM2XXX", accountName: "Juan Dela Cruz", accountNumberLast4: "4567" },
      destinationHoldUntil: null, createdAt: "2026-11-20T00:00:00Z" }] });
    payouts.list.mockResolvedValue({ records: [stuck] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the wallet balance, the next weekly payout and the cash-out limits", async () => {
    renderPage();
    expect(await screen.findByText("₱12,500.00")).toBeTruthy();
    expect(screen.getByText("Friday 8:00 PM")).toBeTruthy();
    expect(screen.getByText("₱100.00 minimum, ₱10,000.00 a day")).toBeTruthy();
    expect(screen.getAllByText("GCash •••• 4567").length).toBeGreaterThan(0);
  });

  it("explains an unconfigured wallet instead of showing an empty state", async () => {
    payouts.overview.mockResolvedValue({ wallet: { configured: false, available: null, lowFloatAlert: 0 }, counts: {}, needsReview: [],
      nextScheduledAt: null });
    renderPage();
    expect(await screen.findByText("The payout wallet is not set")).toBeTruthy();
    expect(screen.getByText(/payouts runbook/)).toBeTruthy();
  });

  it("resolving a payout requires a note and posts the outcome", async () => {
    payouts.resolve.mockResolvedValue({ ...stuck, status: "failed" });
    renderPage();
    // The reference to look up in the provider's dashboard: the payout id without po_, upper case.
    expect(await screen.findByText("AB12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolve po_ab12" }));
    fireEvent.click(await screen.findByText("Mark as failed"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Mark as failed" });
    fireEvent.click(confirm);
    expect(payouts.resolve).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "No transfer with this reference" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(payouts.resolve).toHaveBeenCalledWith({ organizationId: "org_1", projectId: "prj_1", kind: "test" }, "po_ab12",
      "failed", "No transfer with this reference"));
  });

  it("lets only platform operators resolve payouts or change settings", async () => {
    environment.platformAdmin = false;
    renderPage();
    await screen.findByText("₱12,500.00");
    expect(screen.queryByRole("button", { name: "Resolve po_ab12" })).toBeNull();
    const settingsButton = screen.getByRole("button", { name: /Payout settings/ });
    expect(settingsButton.hasAttribute("disabled")).toBe(true);
  });

  it("saves settings with amounts converted from pesos", async () => {
    payouts.saveSettings.mockImplementation(async (_scope, body) => body);
    renderPage();
    await screen.findByText("₱12,500.00");
    fireEvent.click(screen.getByRole("button", { name: /Payout settings/ }));
    const minimum = await screen.findByLabelText("Minimum (₱)");
    fireEvent.change(minimum, { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(payouts.saveSettings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      schedule: { weekday: 1, hour: 20 }, onDemand: { minimum: 20_000, dailyCap: 1_000_000 } })));
  });

  it("surfaces an API failure with its message", async () => {
    payouts.list.mockRejectedValue(new ApiError("Payment runtime unavailable", 502, "PAYMENT_UPSTREAM_UNREACHABLE"));
    renderPage();
    expect(await screen.findByText("Payouts could not be loaded")).toBeTruthy();
  });
});
