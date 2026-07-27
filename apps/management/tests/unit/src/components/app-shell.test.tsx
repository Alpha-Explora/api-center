import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { renderWithQueryClient } from "@tests/support/render-with-query-client";

const apiClient = vi.hoisted(() => ({
  getManagementSession: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  pathname: "/promotions",
}));

vi.mock("@/lib/api-center-client", () => apiClient);
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("AppShell", () => {
  beforeEach(() => {
    apiClient.getManagementSession.mockResolvedValue({
      role: "admin",
      email: "platform@example.com",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("provides a skip link to the main content region", () => {
    renderWithQueryClient(
      <AppShell
        environment={{
          key: "local",
          label: "LOCAL",
          description: "Local/private management session",
          isLive: false,
        }}
        authMode="local-dev"
      >
        <h1>Promotion controls</h1>
      </AppShell>,
    );

    const skipLink = screen.getByRole("link", {
      name: "Skip to main content",
    });
    const main = screen.getByRole("main");

    expect(skipLink.getAttribute("href")).toBe("#main-content");
    expect(main.getAttribute("id")).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("surfaces task-oriented workflow search results", () => {
    renderWithQueryClient(
      <AppShell
        environment={{
          key: "local",
          label: "LOCAL",
          description: "Local/private management session",
          isLive: false,
        }}
        authMode="local-dev"
      >
        <h1>Promotion controls</h1>
      </AppShell>,
    );

    const searchInput = screen.getByLabelText("Find command or workflow");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, {
      target: { value: "rate limit" },
    });

    expect(
      screen
        .getAllByRole("link", { name: /Quotas/ })
        .some(
          (link) =>
            link.getAttribute("href") === "/quotas" &&
            link.textContent?.includes("Set and review quota policy"),
        ),
    ).toBe(true);
  });
});
