import { InternalJwtProvider } from "./internal-jwt.provider";
import { ConfigService } from "../../config/config.service";

const tokenPayloads = new Map<string, Record<string, unknown>>();
let tokenCounter = 0;

jest.mock("jose", () => {
  class MockSignJWT {
    private subject = "";
    private issuer = "";
    private audience = "";
    private expiresIn = "";
    private jti = "";

    constructor(private readonly claims: Record<string, unknown>) {}

    setProtectedHeader() {
      return this;
    }

    setJti(jti: string) {
      this.jti = jti;
      return this;
    }

    setSubject(subject: string) {
      this.subject = subject;
      return this;
    }

    setIssuer(issuer: string) {
      this.issuer = issuer;
      return this;
    }

    setAudience(audience: string) {
      this.audience = audience;
      return this;
    }

    setIssuedAt() {
      return this;
    }

    setExpirationTime(expiresIn: string) {
      this.expiresIn = expiresIn;
      return this;
    }

    async sign() {
      const token = `token-${++tokenCounter}`;
      tokenPayloads.set(token, {
        ...this.claims,
        sub: this.subject,
        iss: this.issuer,
        aud: this.audience,
        exp: this.expiresIn,
        jti: this.jti,
      });
      return token;
    }
  }

  return {
    exportJWK: jest.fn().mockResolvedValue({ kty: "RSA" }),
    importPKCS8: jest.fn().mockResolvedValue("private-key"),
    importSPKI: jest.fn().mockResolvedValue("public-key"),
    jwtVerify: jest.fn(
      async (
        token: string,
        _key: unknown,
        options: { issuer: string; audience: string },
      ) => {
        const payload = tokenPayloads.get(token);
        if (!payload) throw new Error("unknown token");
        if (payload.iss !== options.issuer) throw new Error("bad issuer");
        if (payload.aud !== options.audience) throw new Error("bad audience");
        return { payload };
      },
    ),
    SignJWT: MockSignJWT,
  };
});

function createProvider(overrides: Partial<ConfigService["internalJwt"]> = {}) {
  const config = {
    authProvider: "internal-jwt",
    internalJwt: {
      issuer: "https://api-center.test",
      audience: "api-center",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
      privateKey: "private-key",
      publicKey: "public-key",
      ...overrides,
    },
  } as ConfigService;

  return { provider: new InternalJwtProvider(config), config };
}

describe("InternalJwtProvider", () => {
  beforeEach(() => {
    tokenPayloads.clear();
    tokenCounter = 0;
    jest.clearAllMocks();
  });

  it("issues a tribe access token with scopes and permissions", async () => {
    const { provider } = createProvider();
    await provider.onModuleInit();

    const issued = await provider.issueToken(
      "smoke-tribe",
      ["tribe:smoke-tribe:read"],
      ["geo:read"],
    );

    const claims = await provider.validateToken(issued.accessToken);

    expect(claims.sub).toBe("smoke-tribe");
    expect(claims.tribeId).toBe("smoke-tribe");
    expect(claims.permissions).toContain("tribe:smoke-tribe:read");
    expect(claims.scopes).toContain("geo:read");
    expect(claims.jti).toEqual(expect.any(String));
    expect(issued.refreshToken).toBeTruthy();
    expect(issued.refreshExpiresIn).toBe(86400);
  });

  it("refreshes using only a refresh token", async () => {
    const { provider } = createProvider();
    await provider.onModuleInit();
    const issued = await provider.issueToken(
      "smoke-tribe",
      ["tribe:smoke-tribe:read"],
      ["geo:read"],
    );

    const refreshed = await provider.refreshToken(issued.refreshToken!);
    const claims = await provider.validateToken(refreshed.accessToken);

    expect(claims.sub).toBe("smoke-tribe");
    expect(claims.permissions).toContain("tribe:smoke-tribe:read");
    expect(claims.scopes).toContain("geo:read");
  });

  it("rejects access tokens passed to refresh", async () => {
    const { provider } = createProvider();
    await provider.onModuleInit();
    const issued = await provider.issueToken("smoke-tribe", [], ["geo:read"]);

    await expect(provider.refreshToken(issued.accessToken)).rejects.toThrow(
      "Provided token is not a refresh token",
    );
  });

  it("rejects tokens with the wrong audience", async () => {
    const { provider } = createProvider({ audience: "expected-audience" });
    await provider.onModuleInit();
    const issued = await provider.issueToken("smoke-tribe", [], ["geo:read"]);
    const payload = tokenPayloads.get(issued.accessToken);
    tokenPayloads.set(issued.accessToken, {
      ...payload,
      aud: "other-audience",
    });

    await expect(provider.validateToken(issued.accessToken)).rejects.toThrow(
      "bad audience",
    );
  });
});
