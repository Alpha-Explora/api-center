import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getIdTokenClient } = vi.hoisted(() => ({ getIdTokenClient: vi.fn() }));
vi.mock("google-auth-library", () => ({ GoogleAuth: class { getIdTokenClient = getIdTokenClient; } }));
import { fetchApiCenter } from "@/lib/server/api-center-admin";

describe("Management Cloud Run request authentication", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok"))); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("uses ordinary fetch when runtime authentication is disabled", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "https://disabled.run.app");
    vi.stubEnv("API_CENTER_CLOUD_RUN_AUTH_ENABLED", "false");
    await fetchApiCenter("https://disabled.run.app/api/v1/status");
    expect(getIdTokenClient).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("preserves application authorization while adding Cloud Run identity", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "https://private-console.run.app");
    vi.stubEnv("API_CENTER_CLOUD_RUN_AUTH_ENABLED", "true");
    getIdTokenClient.mockResolvedValue({ getRequestHeaders: vi.fn().mockResolvedValue(new Headers({ authorization: "Bearer google-identity" })) });
    await fetchApiCenter("https://private-console.run.app/api/v1/status", { headers: { authorization: "Bearer application-token" } });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer application-token");
    expect(headers.get("x-serverless-authorization")).toBe("Bearer google-identity");
  });
  it("does not send runtime identity to another origin", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "https://origin-boundary.run.app");
    vi.stubEnv("API_CENTER_CLOUD_RUN_AUTH_ENABLED", "true");
    await fetchApiCenter("https://receiver.example.test/health");
    expect(getIdTokenClient).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toBeUndefined();
  });
  it("retries client creation after an identity failure", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "https://retry-console.run.app");
    vi.stubEnv("API_CENTER_CLOUD_RUN_AUTH_ENABLED", "true");
    getIdTokenClient.mockRejectedValueOnce(new Error("identity unavailable")).mockResolvedValueOnce({ getRequestHeaders: vi.fn().mockResolvedValue(new Headers({ authorization: "Bearer recovered-identity" })) });
    await expect(fetchApiCenter("https://retry-console.run.app/status")).rejects.toThrow("identity unavailable");
    await fetchApiCenter("https://retry-console.run.app/status");
    expect(getIdTokenClient).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("fails before fetching when the identity header is missing", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "https://empty-console.run.app");
    vi.stubEnv("API_CENTER_CLOUD_RUN_AUTH_ENABLED", "true");
    getIdTokenClient.mockResolvedValue({ getRequestHeaders: vi.fn().mockResolvedValue(new Headers()) });
    await expect(fetchApiCenter("https://empty-console.run.app/status")).rejects.toThrow("Cloud Run identity token is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
});
