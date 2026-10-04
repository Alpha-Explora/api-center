import { DevJwtProvider } from "../../../../../apps/gateway/src/domains/auth-security/auth/providers/dev-jwt.provider";
import { ConfigService } from "../../../../../apps/gateway/src/config/config.service";

const tokenPayloads = new Map<string, Record<string, unknown>>();
let tokenCounter = 0;

jest.mock("jose", () => {
  class MockSignJWT {
    private subject = "";
    private issuer = "";
    private expiresIn = "";

    constructor(private readonly claims: Record<string, unknown>) {}

    setProtectedHeader() {
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
        exp: this.expiresIn,
      });
      return token;
    }
  }

  return {
    exportJWK: jest.fn().mockResolvedValue({ kty: "RSA" }),
    generateKeyPair: jest.fn().mockResolvedValue({
      privateKey: "private-key",
      publicKey: "public-key",
    }),
    importPKCS8: jest.fn().mockResolvedValue("private-key"),
    importSPKI: jest.fn().mockResolvedValue("public-key"),
    jwtVerify: jest.fn(
      async (token: string, _key: unknown, options: { issuer: string }) => {
        const payload = tokenPayloads.get(token);
        if (!payload) throw new Error("unknown token");
        if (payload.iss !== options.issuer) throw new Error("bad issuer");
        return { payload };
      },
    ),
    SignJWT: MockSignJWT,
  };
});

function createProvider() {
  const config = {
    authProvider: "dev-jwt",
    devJwt: {
      issuer: "https://api-center.test",
      tokenTtlSeconds: 3600,
      refreshTtlMultiplier: 24,
    },
    vault: {
      transitKey: "",
      secretPath: "",
    },
  } as ConfigService;

  return new DevJwtProvider(config, undefined as never);
}

describe("DevJwtProvider", () => {
  beforeEach(() => {
    tokenPayloads.clear();
    tokenCounter = 0;
    jest.clearAllMocks();
  });

  it("issues and refreshes tokens with environment and source service claims", async () => {
    const provider = createProvider();
    await provider.onModuleInit();

    const issued = await provider.issueToken(
      "smoke-tribe",
      ["tribe:smoke-tribe:read"],
      ["geo:read"],
      { environment: "test", sourceServiceId: "smoke-api" },
    );

    const issuedClaims = await provider.validateToken(issued.accessToken);
    expect(issuedClaims).toEqual(
      expect.objectContaining({
        sub: "smoke-tribe",
        tribeId: "smoke-tribe",
        sourceServiceId: "smoke-api",
        environment: "test",
      }),
    );

    const refreshed = await provider.refreshToken(issued.refreshToken!);
    const refreshedClaims = await provider.validateToken(refreshed.accessToken);
    expect(refreshedClaims).toEqual(
      expect.objectContaining({
        sub: "smoke-tribe",
        tribeId: "smoke-tribe",
        sourceServiceId: "smoke-api",
        environment: "test",
      }),
    );
    expect(refreshedClaims.permissions).toContain("tribe:smoke-tribe:read");
    expect(refreshedClaims.scopes).toContain("geo:read");
  });
});