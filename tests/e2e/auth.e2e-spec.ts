import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";

import { AuthController } from "../../apps/gateway/src/domains/auth-security/auth/auth.controller";
import { AuthService } from "../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { RegistryService } from "../../apps/gateway/src/domains/catalog-registry";
import { TENANCY_DIRECTORY } from "../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";
import { LoggerService } from "../../apps/gateway/src/shared/logger.service";
import { ConfigService } from "../../apps/gateway/src/config/config.service";
import { JwtAuthGuard } from "../../apps/gateway/src/domains/auth-security";

describe("AuthController (e2e)", () => {
  let app: INestApplication;
  let baseUrl: string;

  const authService = {
    issueServiceToken: jest.fn().mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    }),
    refreshToken: jest.fn().mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresIn: 3600,
    }),
    revokeToken: jest.fn().mockResolvedValue({
      sub: "svc-alpha",
      revokedCount: 1,
    }),
    getJwksJson: jest.fn().mockReturnValue({ keys: [{ kid: "dev-key" }] }),
  } as unknown as AuthService;

  const registryService = {
    get: jest.fn(),
    getOwnedServices: jest.fn().mockReturnValue([]),
    getCallableServiceIds: jest.fn().mockReturnValue([]),
    validateEnvironmentSecret: jest.fn().mockResolvedValue(true),
  } as unknown as RegistryService;

  const tenancyDirectory = {
    requireActiveProject: jest.fn().mockReturnValue({
      tribe: { tribeId: "alpha", status: "active" },
      project: { projectId: "alpha-default", tribeId: "alpha", status: "active" },
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RegistryService, useValue: registryService },
        { provide: TENANCY_DIRECTORY, useValue: tenancyDirectory },
        {
          provide: LoggerService,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: "KafkaService",
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
            publishNonBlocking: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            authProvider: "dev-jwt",
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: () => true },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (registryService.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
      true,
    );
    (registryService.getOwnedServices as jest.Mock).mockReturnValue([]);
    (registryService.getCallableServiceIds as jest.Mock).mockReturnValue([]);
    (tenancyDirectory.requireActiveProject as jest.Mock).mockReturnValue({
      tribe: { tribeId: "alpha", status: "active" },
      project: { projectId: "alpha-default", tribeId: "alpha", status: "active" },
    });
    (registryService.get as jest.Mock).mockImplementation(
      (serviceId: string) => {
        if (serviceId === "svc-alpha") {
          return {
            serviceId: "svc-alpha",
            projectId: "alpha-default",
            ownerTribeId: "alpha",
            requiredScopes: ["scope:read"],
            consumes: [],
            environments: [{ environment: "test", status: "active" }],
          };
        }
        return null;
      },
    );
  });

  it("should issue a token for valid service credentials", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "svc-alpha",
        environment: "test",
        secret: "svc-secret",
      }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: {
        accessToken: string;
        refreshToken: string | null;
        tribeId: string;
        projectId: string;
        serviceId: string;
      };
    };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBe("access-token");
    expect(body.data).toMatchObject({
      serviceId: "svc-alpha",
      projectId: "alpha-default",
      tribeId: "alpha",
    });
  });

  it("should reject token issuance for unknown services", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "unknown-service",
        environment: "test",
        secret: "svc-secret",
      }),
    });

    expect(response.status).toBe(404);
  });

  it("should refresh token via /api/v1/auth/token/refresh", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "refresh-token" }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: { accessToken: string; refreshToken: string | null };
    };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBe("refreshed-access-token");
  });

  it("should return JWKS when provider serves in-process keys", async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/.well-known/jwks.json`,
    );
    const body = (await response.json()) as { keys: Array<{ kid: string }> };

    expect(response.status).toBe(200);
    expect(body.keys[0].kid).toBe("dev-key");
  });
});
