import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeatureAccess } from "@/components/patterns/feature-access";
import type { FeatureView } from "@/features/control-plane/model/features";

const featureAccess = vi.hoisted(() => ({ list: vi.fn(), request: vi.fn(), cancel: vi.fn() }));
vi.mock("@/features/control-plane/data/features", () => ({ featureAccess }));
vi.mock("@/features/control-plane/view-models/project-environment", () => ({
  useProjectEnvironment: () => ({ organizationId: "org_1", project: { id: "prj_1" }, kind: "test", canWrite: true }),
}));
vi.mock("@/features/control-plane/view-models/use-organization", () => ({
  useOrganization: () => ({ session: { email: "admin@example.test" } }),
}));

const feature: FeatureView = {
  key: "payouts.payee_wallets", title: "Payee wallet onboarding", description: "Pilot",
  release: "pilot", offered: true, paused: false, pending: null, last: null,
};

function renderAccess(view: FeatureView) {
  featureAccess.list.mockResolvedValue([view]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><FeatureAccess feature={feature.key} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("requires a reason and shows the pending request after it is submitted", async () => {
  renderAccess(feature);
  featureAccess.request.mockImplementation(async () => {
    featureAccess.list.mockResolvedValue([{ ...feature, pending: {
      id: "frq_fixture", feature: feature.key, change: {}, reason: "Test our workflow", status: "pending",
      requestedBy: "admin@example.test", decisionNote: null, createdAt: "2026-11-25T00:00:00Z",
    } }]);
  });
  fireEvent.click(await screen.findByRole("button", { name: "Request access" }));
  const dialog = within(await screen.findByRole("dialog"));
  const send = dialog.getByRole("button", { name: "Send request" });
  expect(send.hasAttribute("disabled")).toBe(true);
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Test our workflow" } });
  fireEvent.click(send);
  await waitFor(() => expect(featureAccess.request).toHaveBeenCalledWith(
    { organizationId: "org_1", projectId: "prj_1", kind: "test" },
    { feature: feature.key, change: {}, reason: "Test our workflow" },
  ));
  expect(await screen.findByText("Pending approval from APICenter")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
});

it("shows a pause and still accepts requests for a released pilot", async () => {
  renderAccess({ ...feature, paused: true });
  expect(await screen.findByText("Paused by APICenter")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request access" })).toBeTruthy();
});
