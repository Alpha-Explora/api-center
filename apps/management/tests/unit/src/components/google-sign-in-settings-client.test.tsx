import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleSignInSettingsClient } from "@/components/google-sign-in-settings-client";

const tenancyMocks = vi.hoisted(() => ({ listTribes: vi.fn() }));
vi.mock("@/lib/api-center/tenancy-client", () => tenancyMocks);

describe("GoogleSignInSettingsClient", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("loads a project, saves a write-only client secret, and shows its last changed time", async () => {
    tenancyMocks.listTribes.mockResolvedValue([{
      tribeId: "acme", name: "Acme", projects: [{ projectId: "shop", name: "Shop", status: "active" }],
    }]);
    let savedSettings: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        savedSettings = {
          projectId: "shop", environment: "test", redirectUris: ["http://localhost:3000/callback"],
          displayName: "Shop", hasOwnClient: true, clientId: "client-id", secretLastChangedAt: "2026-10-01T00:00:00.000Z",
        };
        return Response.json(savedSettings);
      }
      if (savedSettings) return Response.json(savedSettings);
      return Response.json({
        projectId: "shop", environment: "test", redirectUris: ["http://localhost:3000/callback"],
        displayName: "Shop", hasOwnClient: false, clientId: null, secretLastChangedAt: null,
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><GoogleSignInSettingsClient /></QueryClientProvider>);

    expect(await screen.findByText(/currently uses the APICenter Google client/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use your own Google client" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Client ID" }), { target: { value: "client-id" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/google-sign-in/projects/shop/test",
      expect.objectContaining({ method: "PUT", body: expect.stringContaining("super-secret") }),
    ));
    expect(await screen.findByText(/currently uses its own Google client/)).toBeTruthy();
    expect(screen.getByText(/Client secret last changed/)).toBeTruthy();
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
    queryClient.clear();
  });
});
