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

    await service.issueServiceToken(
      { serviceId: "svc-alpha", projectId: "alpha-core", tribeId: "alpha" },
      ["perm:read"],
      ["scope:read"],
      "test",
    );

    expect(mockProvider.issueToken).toHaveBeenCalledWith(
      "svc-alpha",
      ["perm:read"],
      ["scope:read"],
      expect.objectContaining({
        tribeId: "alpha",
        projectId: "alpha-core",
        sourceServiceId: "svc-alpha",
        environment: "test",
      }),
    );
    expect(mockTokenStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        jti: "new-jti",
        sub: "svc-alpha",
        tribeId: "alpha",
        projectId: "alpha-core",
        sourceServiceId: "svc-alpha",
        environment: "test",
        permissions: ["perm:read"],
        scopes: ["scope:read"],
      }),
    );
  });

  it("should reject service token issuance without an environment", async () => {
    await expect(
      service.issueServiceToken(
        { serviceId: "svc-alpha", projectId: "alpha-core", tribeId: "alpha" },
        [],
        [],
        undefined as never,
      ),
    ).rejects.toThrow(ValidationError);
    expect(mockProvider.issueToken).not.toHaveBeenCalled();
  });

  it("should not persist refresh token metadata when provider omits refresh token", async () => {
    (mockProvider.issueToken as jest.Mock).mockResolvedValue({
      accessToken: "a",
      refreshToken: null,
      expiresIn: 60,
    } as IssuedToken);

    await service.issueServiceToken(
      { serviceId: "svc-alpha", projectId: "alpha-core", tribeId: "alpha" },
      [],
      [],
      "test",
    );

    expect(mockTokenStore.store).not.toHaveBeenCalled();
  });

  it("should reject refresh token when jti exists but token store marks it invalid", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(false);

    const revalidate = jest.fn();
    await expect(service.refreshToken("refresh-token", revalidate)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(revalidate).not.toHaveBeenCalled();
  });

  describe("refresh revalidation", () => {
    const oldRecord: RefreshTokenRecord = {
      jti: "jti-1",
      sub: "svc-alpha",
      tribeId: "alpha",
      projectId: "alpha-core",
      sourceServiceId: "svc-alpha",
      environment: "live",
      issuedAt: 1,
      expiresAt: 999,
      permissions: ["perm:read"],
      scopes: ["old:scope"],
    };
    const grant = {
      identity: { serviceId: "svc-alpha", projectId: "alpha-core", tribeId: "alpha" },
      permissions: ["perm:read"],
      scopes: ["new:scope"],
    };

    beforeEach(() => {
      (mockProvider.validateToken as jest.Mock).mockImplementation(
        async (token: string) =>
          token === "refresh-token"
            ? ({ sub: "svc-alpha", jti: "jti-1" } as Partial<JwtClaims>)
            : ({ sub: "svc-alpha", jti: "jti-2", environment: "live" } as Partial<JwtClaims>),
      );
      (mockTokenStore.isValid as jest.Mock).mockResolvedValue(true);
      (mockTokenStore.get as jest.Mock).mockResolvedValue(oldRecord);
      (mockProvider.issueToken as jest.Mock).mockResolvedValue({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 120,
      } as IssuedToken);
    });

    it("rotates the refresh token and issues the scopes the service holds now", async () => {
      const revalidate = jest.fn().mockReturnValue(grant);

      await service.refreshToken("refresh-token", revalidate);

      expect(revalidate).toHaveBeenCalledWith({
        serviceId: "svc-alpha",
        environment: "live",
        projectId: "alpha-core",
      });
      expect(mockTokenStore.revoke).toHaveBeenCalledWith("jti-1");
      expect(mockProvider.refreshToken).not.toHaveBeenCalled();
      expect(mockProvider.issueToken).toHaveBeenCalledWith(
        "svc-alpha",
        ["perm:read"],
        ["new:scope"],
        expect.objectContaining({ projectId: "alpha-core", tribeId: "alpha", environment: "live" }),
      );
      expect(mockTokenStore.store).toHaveBeenCalledWith(
        expect.objectContaining({ jti: "jti-2", projectId: "alpha-core", scopes: ["new:scope"] }),
      );
    });

    it("keeps the refresh token usable when revalidation refuses the service", async () => {
      const revalidate = jest.fn(() => {
        throw new ForbiddenError("Tribe 'alpha' is suspended");
      });

      await expect(service.refreshToken("refresh-token", revalidate)).rejects.toThrow(ForbiddenError);
      expect(mockTokenStore.revoke).not.toHaveBeenCalled();
      expect(mockProvider.issueToken).not.toHaveBeenCalled();
    });

    it("refuses refresh tokens issued before project placement", async () => {
      (mockTokenStore.get as jest.Mock).mockResolvedValue({ ...oldRecord, projectId: undefined });
      const revalidate = jest.fn();

      await expect(service.refreshToken("refresh-token", revalidate)).rejects.toThrow(
        "Refresh token predates project placement",
      );
      expect(revalidate).not.toHaveBeenCalled();
    });
  });

  it("should reject refresh token when metadata is missing for a valid jti", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(true);
    (mockTokenStore.get as jest.Mock).mockResolvedValue(null);

    await expect(service.refreshToken("refresh-token", jest.fn())).rejects.toThrow(
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
