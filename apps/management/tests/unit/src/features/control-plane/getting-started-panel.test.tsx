import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GettingStartedPanel } from "@/features/control-plane/views/overview/getting-started-panel";

const repository = vi.hoisted(() => ({ applications: vi.fn(), usage: vi.fn() }));
const inventory = vi.hoisted(() => ({ grants: [] as unknown[], credentials: [] as unknown[] }));

vi.mock("@/features/control-plane/data/control-plane-repository", () => ({ controlPlane: repository }));
vi.mock("@/features/control-plane/view-models/environment-inventory", () => ({
  useEnvironmentGrants: () => ({ data: inventory.grants }),
  useEnvironmentCredentials: () => ({ data: inventory.credentials }),
}));
vi.mock("@/features/control-plane/view-models/project-environment", () => ({
  useProjectEnvironment: () => ({
    organizationId: "org_1",
    project: { id: "prj_1", name: "Serbizio" },
    kind: "test",
    environment: { kind: "test", status: "active", capabilities: [{ capability: "email", status: "enabled" }] },
  }),
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GettingStartedPanel />
    </QueryClientProvider>,
  );
}

/** An in-memory Storage: this test environment does not provide window.localStorage. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

describe("GettingStartedPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    repository.applications.mockResolvedValue([{ id: "app_1", status: "active" }]);
    repository.usage.mockResolvedValue({ since: "2026-11-20T00:00:00Z", requests: 0, byApplicationAction: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    inventory.grants = [];
    inventory.credentials = [];
  });

  it("points at the next step instead of SDK code before there is a key", async () => {
    renderPanel();

    expect(await screen.findByText("Next step")).toBeTruthy();
    expect(screen.getAllByText("Grant actions").length).toBeGreaterThan(0);
    expect(screen.queryByText("First request")).toBeNull();
  });

  it("shows the SDK code once the next step is issuing a key", async () => {
    inventory.grants = [{ id: "grt_1", action: "email:send", status: "active", applicationId: "app_1", provenance: "console" }];
    renderPanel();

    expect(await screen.findByText("First request")).toBeTruthy();
  });

  it("folds away on request, offers the next step from the header, and remembers it", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Hide/ }));

    expect(screen.queryByText("Next step")).toBeNull();
    expect(screen.getByRole("link", { name: /Next: Grant actions/ })).toBeTruthy();
    expect(window.localStorage.getItem("apicenter.gettingStarted.prj_1.test")).toBe("folded");
  });
});
