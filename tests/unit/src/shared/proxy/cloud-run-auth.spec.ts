import {
  buildCloudRunAudience,
  clearCloudRunAuthCacheForTesting,
  getCloudRunAuthorizationHeader,
  shouldUseCloudRunAuth,
} from "../../../../../apps/gateway/src/shared/proxy/cloud-run-auth";

const mockGetRequestHeaders = jest.fn();
const mockGetIdTokenClient = jest.fn();

jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getIdTokenClient: (...args: unknown[]) => mockGetIdTokenClient(...args),
  })),
}));

describe("cloud-run-auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCloudRunAuthCacheForTesting();
    mockGetIdTokenClient.mockResolvedValue({
      getRequestHeaders: mockGetRequestHeaders,
    });
    mockGetRequestHeaders.mockResolvedValue({
      Authorization: "Bearer id-token-123",
    });
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not use Cloud Run auth when disabled", () => {
    delete process.env.K_SERVICE;
    expect(shouldUseCloudRunAuth("https://payment-live.run.app")).toBe(false);
  });

  it("uses Cloud Run auth for https run.app upstreams when enabled", () => {
    process.env.K_SERVICE = "apicenter-gateway";
    expect(shouldUseCloudRunAuth("https://payment-live-abc.a.run.app")).toBe(
      true,
    );
  });

  it("does not use Cloud Run auth for Kubernetes service URLs", () => {
    process.env.K_SERVICE = "apicenter-gateway";
    expect(
      shouldUseCloudRunAuth(
        "http://payment-live.api-center.svc.cluster.local:4010",
      ),
    ).toBe(false);
  });

  it("builds the audience from the upstream origin", () => {
    expect(
      buildCloudRunAudience("https://payment-live-abc.a.run.app/webhooks"),
    ).toBe("https://payment-live-abc.a.run.app");
  });

  it("returns and caches a bearer token for Cloud Run upstreams", async () => {
    process.env.K_SERVICE = "apicenter-gateway";
    mockGetIdTokenClient.mockResolvedValue({
      idTokenProvider: {
        fetchIdToken: jest.fn(async () => "direct-id-token-123"),
      },
      targetAudience: "https://payment-live-abc.a.run.app",
      getRequestHeaders: mockGetRequestHeaders,
    });

    await expect(
      getCloudRunAuthorizationHeader(
        "https://payment-live-abc.a.run.app/webhooks",
      ),
    ).resolves.toBe("Bearer direct-id-token-123");
    await expect(
      getCloudRunAuthorizationHeader(
        "https://payment-live-abc.a.run.app/health",
      ),
    ).resolves.toBe("Bearer direct-id-token-123");

    expect(mockGetIdTokenClient).toHaveBeenCalledTimes(1);
    expect(mockGetIdTokenClient).toHaveBeenCalledWith(
      "https://payment-live-abc.a.run.app",
    );
    expect(mockGetRequestHeaders).not.toHaveBeenCalled();
  });

  it("reads authorization from headers-like objects returned by Google auth", async () => {
    process.env.K_SERVICE = "apicenter-gateway";
    mockGetRequestHeaders.mockResolvedValue({
      get: (name: string) =>
        name.toLowerCase() === "authorization"
          ? "Bearer id-token-from-headers-like"
          : null,
    });

    await expect(
      getCloudRunAuthorizationHeader("https://payment-test-abc.a.run.app"),
    ).resolves.toBe("Bearer id-token-from-headers-like");
  });
});
