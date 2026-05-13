import { AuthService } from "./auth.service";
import {
  AuthProvider,
  IssuedToken,
  JwtClaims,
} from "./auth-provider.interface";
import { TokenStoreService } from "./token-store.service";
import { LoggerService } from "../shared/logger.service";
import { ForbiddenError, UnauthorizedError } from "../shared/errors";
import { AuthenticatedRequest } from "../types";

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

  it("should persist refresh token metadata when provider returns a refresh token", async () => {
    (mockProvider.issueToken as jest.Mock).mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 60,
    } as IssuedToken);

    await service.issueToken("svc-alpha", ["perm:read"], ["scope:read"]);

    expect(mockTokenStore.store).toHaveBeenCalledWith(
      expect.objectContaining({
        jti: "uuid-fixed",
        sub: "svc-alpha",
        tribeId: "svc-alpha",
        permissions: ["perm:read"],
        scopes: ["scope:read"],
      }),
    );
  });

  it("should not persist refresh token metadata when provider omits refresh token", async () => {
    (mockProvider.issueToken as jest.Mock).mockResolvedValue({
      accessToken: "a",
      refreshToken: null,
      expiresIn: 60,
    } as IssuedToken);

    await service.issueToken("svc-alpha");

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

  it("should rotate refresh tokens by revoking old jti and storing a new one", async () => {
    (mockProvider.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      jti: "jti-1",
    } as Partial<JwtClaims>);
    (mockTokenStore.isValid as jest.Mock).mockResolvedValue(true);
    (mockProvider.refreshToken as jest.Mock).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 120,
    } as IssuedToken);

    await service.refreshToken("refresh-token");

    expect(mockTokenStore.revoke).toHaveBeenCalledWith("jti-1");
    expect(mockTokenStore.store).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "svc-alpha", tribeId: "svc-alpha" }),
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
