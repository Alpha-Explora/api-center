import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import {
  AuthProvider,
  IssuedToken,
  JwtClaims,
} from "../../../../apps/gateway/src/domains/auth-security/auth/auth-provider.interface";
import { RefreshTokenRecord, TokenStoreService } from "../../../../apps/gateway/src/domains/auth-security/auth/token-store.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn(() => "uuid-fixed"),
}));

describe("AuthService", () => {
  const mockProvider = {
    validateToken: jest.fn(),
    issueToken: jest.fn(),
    refreshToken: jest.fn(),
    getJwksJson: jest.fn(),
  } as unknown as AuthProvider;

  const mockTokenStore = {
    store: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    isValid: jest.fn().mockResolvedValue(true),
    revoke: jest.fn().mockResolvedValue(true),
    revokeAllForSubject: jest.fn().mockResolvedValue(0),
  } as unknown as TokenStoreService;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(mockProvider, mockTokenStore, mockLogger);
  });

  it("should persist refresh token metadata with environment and source service", async () => {
    (mockProvider.issueToken as jest.Mock).mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 60,
    } as IssuedToken);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "new-jti",
      environment: "test",
    } as Partial<JwtClaims>);

    await service.issueTribeToken(
      "svc-alpha",
      ["perm:read"],
      ["scope:read"],
      { environment: "test", sourceServiceId: "svc-alpha-worker" },
    );

    expect(mockProvider.issueToken).toHaveBeenCalledWith(
      "svc-alpha",
      ["perm:read"],
      ["scope:read"],
      expect.objectContaining({
        tribeId: "svc-alpha",
        sourceServiceId: "svc-alpha-worker",
        environment: "test",
      }),
    );
    expect(mockTokenStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        jti: "new-jti",
        sub: "svc-alpha",
        tribeId: "svc-alpha",
        sourceServiceId: "svc-alpha-worker",
        environment: "test",
        permissions: ["perm:read"],
        scopes: ["scope:read"],
      }),
    );
  });

  it("should reject tribe token issuance without an environment", async () => {
    await expect(
      service.issueTribeToken("svc-alpha", [], [], {}),
    ).rejects.toThrow(ValidationError);
    expect(mockProvider.issueToken).not.toHaveBeenCalled();
  });

  it("should not persist refresh token metadata when provider omits refresh token", async () => {
    (mockProvider.issueToken as jest.Mock).mockResolvedValue({
      accessToken: "a",
      refreshToken: null,
      expiresIn: 60,
    } as IssuedToken);

    await service.issueTribeToken("svc-alpha", [], [], { environment: "test" });

    expect(mockTokenStore.store).not.toHaveBeenCalled();
  });

  it("should reject refresh token when jti exists but token store marks it invalid", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(false);

    await expect(service.refreshToken("refresh-token")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("should rotate refresh tokens and preserve stored live environment metadata", async () => {
    const oldRecord: RefreshTokenRecord = {
      jti: "jti-1",
      sub: "svc-alpha",
      tribeId: "svc-alpha",
      sourceServiceId: "svc-alpha-worker",
      environment: "live",
      issuedAt: 1,
      expiresAt: 999,
      permissions: ["perm:read"],
      scopes: ["scope:read"],
    };
    (mockProvider.validateToken as jest.Mock).mockImplementation(
      async (token: string) => {
        if (token === "refresh-token") {
          return { sub: "svc-alpha", jti: "jti-1" } as Partial<JwtClaims>;
        }
        return { sub: "svc-alpha", jti: "jti-2" } as Partial<JwtClaims>;
      },
    );
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(true);
    (mockTokenStore.get as jest.Mock).mockResolvedValue(oldRecord);
    (mockProvider.refreshToken as jest.Mock).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 120,
    } as IssuedToken);

    await service.refreshToken("refresh-token");

    expect(mockTokenStore.revoke).toHaveBeenCalledWith("jti-1");
    expect(mockTokenStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        jti: "jti-2",
        sub: "svc-alpha",
        tribeId: "svc-alpha",
        sourceServiceId: "svc-alpha-worker",
        environment: "live",
        permissions: ["perm:read"],
        scopes: ["scope:read"],
      }),
    );
  });

  it("should reject refresh token when metadata is missing for a valid jti", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(true);
    (mockTokenStore.get as jest.Mock).mockResolvedValue(null);

    await expect(service.refreshToken("refresh-token")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("should revoke all subject tokens when revokeAll is true", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.revokeAllForSubject as jest.Mock).mockResolvedValue(3);

    const result = await service.revokeToken("refresh-token", true);

    expect(result.revokedCount).toBe(3);
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
  });

  it("should throw when caller lacks required permission", async () => {
    const req = {
      user: { scopes: ["scope:read"], permissions: [] },
    } as unknown as AuthenticatedRequest;

    await expect(service.authorize(req, "perm:admin")).rejects.toThrow(
      ForbiddenError,
    );
  });
});