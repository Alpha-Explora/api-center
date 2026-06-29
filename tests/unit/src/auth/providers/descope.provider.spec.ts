import axios from "axios";
import { ConfigService } from "../../../../../src/config/config.service";
import { DescopeProvider, mapDescopeClaims } from "../../../../../src/auth/providers/descope.provider";

jest.mock("axios");
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("DescopeProvider", () => {
  const baseConfig = {
    authProvider: "descope",
    descope: {
      baseUrl: "https://api.descope.com",
      projectId: "p123",
      jwksUri: "https://api.descope.com/p123/.well-known/jwks.json",
      tokenEndpoint: "https://api.descope.com/oauth2/v1/token",
      issuer: "https://api.descope.com/p123",
      audience: "api-center",
      refreshClientId: "api-center",
      defaultClientSecret: "default-secret",
    },
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DESCOPE_CLIENT_SECRET_BILLING_SERVICE;
  });

  describe("mapDescopeClaims", () => {
    it("maps custom app claims into JwtClaims shape", () => {
      const claims = mapDescopeClaims({
        sub: "billing-service",
        exp: 1_800_000_000,
        customClaims: {
          tribeId: "billing-service",
          permissions: ["platform:admin", "tribe:billing-service:read"],
          scopes: ["billing:read", "billing:write"],
        },
      });

      expect(claims.sub).toBe("billing-service");
      expect(claims.tribeId).toBe("billing-service");
      expect(claims.permissions).toEqual([
        "platform:admin",
        "tribe:billing-service:read",
      ]);
      expect(claims.scopes).toEqual(["billing:read", "billing:write"]);
    });

    it("falls back to OAuth scope string when scopes array is not present", () => {
      const claims = mapDescopeClaims({
        sub: "ledger-service",
        scope: "ledger:read ledger:write",
      });

      expect(claims.scopes).toEqual(["ledger:read", "ledger:write"]);
      expect(claims.permissions).toEqual([]);
    });

    it("throws when token has no sub and no fallback subject claim", () => {
      expect(() =>
        mapDescopeClaims({
          customClaims: {
            tribeId: "missing-sub",
          },
        }),
      ).toThrow("missing subject claim");
    });
  });

  describe("issueToken", () => {
    it("uses service-specific client secret when available", async () => {
      process.env.DESCOPE_CLIENT_SECRET_BILLING_SERVICE = "service-secret";
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        },
      });

      const provider = new DescopeProvider(baseConfig);
      const result = await provider.issueToken(
        "billing-service",
        [],
        ["billing:read"],
      );

      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.descope.com/oauth2/v1/token",
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
      );
      const payload = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(payload.get("grant_type")).toBe("client_credentials");
      expect(payload.get("client_id")).toBe("billing-service");
      expect(payload.get("client_secret")).toBe("service-secret");
      expect(payload.get("scope")).toBe("openid billing:read");
    });

    it("falls back to DESCOPE_DEFAULT_CLIENT_SECRET when per-service secret is missing", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "access-token",
          expires_in: 1800,
        },
      });

      const provider = new DescopeProvider(baseConfig);
      const result = await provider.issueToken("catalog-service", [], []);

      expect(result.refreshToken).toBeNull();
      const payload = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(payload.get("client_secret")).toBe("default-secret");
    });
  });

  describe("refreshToken", () => {
    it("preserves refresh endpoint contract", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        },
      });

      const provider = new DescopeProvider(baseConfig);
      const result = await provider.refreshToken("incoming-refresh-token");

      expect(result).toEqual({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      });
      const payload = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(payload.get("grant_type")).toBe("refresh_token");
      expect(payload.get("refresh_token")).toBe("incoming-refresh-token");
      expect(payload.get("client_id")).toBe("api-center");
      expect(payload.get("client_secret")).toBe("default-secret");
    });
  });
});
