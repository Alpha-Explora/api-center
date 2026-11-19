import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithQueryClient } from "@tests/support/render-with-query-client";

const apiClient = vi.hoisted(() => ({
  getManagementSession: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  pathname: "/projects",
  push: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: navigation.push }),
  useSearchParams: () => new URLSearchParams(),
}));


function renderShell() {
  return renderWithQueryClient(
    <TooltipProvider>
      <AppShell authMode="local-dev">
        <h1>Page content</h1>
      </AppShell>
    </TooltipProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    navigation.pathname = "/projects";
    apiClient.getManagementSession.mockResolvedValue({
      userId: "u",
      role: "admin",
      email: "platform@example.com",
      source: "local-dev",
      organizationIds: [],
      organizationRoles: {},
      organizations: [],
      platformAdmin: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("provides a skip link to the main content region", () => {
    renderShell();
    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    const main = screen.getByRole("main");
    expect(skipLink.getAttribute("href")).toBe("#main-content");
    expect(main.getAttribute("id")).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("opens the command palette with Ctrl+K and runs a matching page", async () => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search pages, projects and actions");
    fireEvent.change(input, { target: { value: "teams" } });
    expect(screen.getByRole("option", { name: /People/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigation.push).toHaveBeenCalledWith("/people");
  });

  it("marks the live environment in the chrome", () => {
    navigation.pathname = "/projects/prj_abc/live/applications";
    renderShell();
    expect(screen.getAllByText("Live environment").length).toBeGreaterThan(0);
  });
});
