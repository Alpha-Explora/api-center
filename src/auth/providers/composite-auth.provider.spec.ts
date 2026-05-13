import { CompositeAuthProvider } from "./composite-auth.provider";
import { DescopeProvider } from "./descope.provider";
import { InternalJwtProvider } from "./internal-jwt.provider";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
  exportJWK: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
  SignJWT: jest.fn(),
}));

function mockInternalProvider(options?: {
  validateTokenResult?: Record<string, unknown>;
  validateTokenError?: Error;
}) {
  return {
    issueToken: jest.fn().mockResolvedValue({
      accessToken: "internal-access",
      refreshToken: "internal-refresh",
      expiresIn: 3600,
    }),
    validateToken: jest.fn().mockImplementation(async () => {
      if (options?.validateTokenError) throw options.validateTokenError;
      return options?.validateTokenResult ?? { sub: "internal-sub" };
    }),
    refreshToken: jest.fn().mockResolvedValue({
      accessToken: "new-internal-access",
      refreshToken: "new-internal-refresh",
      expiresIn: 3600,
    }),
    getJwksJson: jest.fn().mockReturnValue({ keys: [{ kid: "internal" }] }),
  } as unknown as jest.Mocked<InternalJwtProvider>;
}

function mockDescopeProvider(options?: {
  validateTokenResult?: Record<string, unknown>;
}) {
  return {
    issueToken: jest.fn(),
    validateToken: jest
      .fn()
      .mockResolvedValue(
        options?.validateTokenResult ?? { sub: "descope-sub" },
      ),
    refreshToken: jest.fn(),
    getJwksJson: jest.fn().mockReturnValue(null),
  } as unknown as jest.Mocked<DescopeProvider>;
}

describe("CompositeAuthProvider", () => {
  it("issues tokens through the internal provider", async () => {
    const internal = mockInternalProvider();
    const descope = mockDescopeProvider();
    const provider = new CompositeAuthProvider(internal, descope);

    await provider.issueToken("smoke-tribe", ["read"], ["geo:read"]);

    expect(internal.issueToken).toHaveBeenCalledWith(
      "smoke-tribe",
      ["read"],
      ["geo:read"],
    );
    expect(descope.issueToken).not.toHaveBeenCalled();
  });

  it("validates internal tokens before falling back to Descope", async () => {
    const internal = mockInternalProvider({
      validateTokenResult: { sub: "internal-sub" },
    });
    const descope = mockDescopeProvider();
    const provider = new CompositeAuthProvider(internal, descope);

    await expect(provider.validateToken("token")).resolves.toMatchObject({
      sub: "internal-sub",
    });
    expect(descope.validateToken).not.toHaveBeenCalled();
  });

  it("falls back to Descope validation when internal validation fails", async () => {
    const internal = mockInternalProvider({
      validateTokenError: new Error("bad token"),
    });
    const descope = mockDescopeProvider({
      validateTokenResult: { sub: "descope-sub" },
    });
    const provider = new CompositeAuthProvider(internal, descope);

    await expect(provider.validateToken("token")).resolves.toMatchObject({
      sub: "descope-sub",
    });
    expect(descope.validateToken).toHaveBeenCalledWith("token");
  });

  it("refreshes tokens through the internal provider", async () => {
    const internal = mockInternalProvider();
    const descope = mockDescopeProvider();
    const provider = new CompositeAuthProvider(internal, descope);

    await provider.refreshToken("refresh");

    expect(internal.refreshToken).toHaveBeenCalledWith("refresh");
    expect(descope.refreshToken).not.toHaveBeenCalled();
  });

  it("serves the internal JWKS", () => {
    const internal = mockInternalProvider();
    const descope = mockDescopeProvider();
    const provider = new CompositeAuthProvider(internal, descope);

    expect(provider.getJwksJson()).toEqual({ keys: [{ kid: "internal" }] });
  });
});
