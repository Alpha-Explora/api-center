import axios from "axios";
import { jwtVerify } from "jose";
import { ConfigService } from "../../config/config.service";
import { GoogleProvider } from "./google.provider";

jest.mock("axios");
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuer: jest.fn().mockReturnThis(),
    setSubject: jest.fn().mockReturnThis(),
    setAudience: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue("assertion-token"),
  })),
  importPKCS8: jest.fn().mockResolvedValue("private-key"),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwtVerify = jwtVerify as jest.Mock;

describe("GoogleProvider", () => {
  const mockConfig = {} as ConfigService;
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...envBackup };
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it("should reject id_token validation when hosted domain is not allowlisted", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ALLOWED_DOMAINS = "company.com";

    const provider = new GoogleProvider(mockConfig);
    provider.onModuleInit();

    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        email: "user@external.com",
        hd: "external.com",
      },
    });

    await expect(provider.validateToken("id-token")).rejects.toThrow(
      "domain 'external.com' is not in the allowed list",
    );
  });

  it("should include hd parameter in authorization URL when exactly one domain is allowed", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ALLOWED_DOMAINS = "company.com";

    const provider = new GoogleProvider(mockConfig);
    provider.onModuleInit();

    const url = provider.buildAuthorizationUrl(
      "http://localhost/callback",
      "state-1",
    );
    const params = new URL(url).searchParams;

    expect(params.get("hd")).toBe("company.com");
  });

  it("should omit hd parameter in authorization URL when multiple domains are allowed", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ALLOWED_DOMAINS = "company.com,partner.com";

    const provider = new GoogleProvider(mockConfig);
    provider.onModuleInit();

    const url = provider.buildAuthorizationUrl("http://localhost/callback");
    const params = new URL(url).searchParams;

    expect(params.get("hd")).toBeNull();
  });

  it("should reject OAuth code exchange when userinfo domain is not allowlisted", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ALLOWED_DOMAINS = "company.com";

    const provider = new GoogleProvider(mockConfig);
    provider.onModuleInit();

    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: "google-access",
        id_token: "google-id-token",
        expires_in: 3600,
      },
    } as any);
    mockedAxios.get.mockResolvedValue({
      data: {
        sub: "user-1",
        email: "user@external.com",
        email_verified: true,
        hd: "external.com",
      },
    } as any);

    await expect(
      provider.exchangeCode("auth-code", "http://localhost/callback"),
    ).rejects.toThrow("domain 'external.com' is not allowed");
  });

  it("should fail M2M issuance when service account key is missing", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    delete process.env.GOOGLE_SA_KEY_BILLING_SERVICE;

    const provider = new GoogleProvider(mockConfig);
    provider.onModuleInit();

    await expect(
      provider.issueToken("billing-service", [], []),
    ).rejects.toThrow(
      "No Google Service Account key found for service 'billing-service'",
    );
  });
});
