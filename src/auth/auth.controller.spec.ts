import { NotFoundException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RegistryService } from "../registry/registry.service";
import { LoggerService } from "../shared/logger.service";
import { KafkaService } from "../kafka/kafka.service";
import { ConfigService } from "../config/config.service";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../shared/errors";
import { AuthenticatedRequest } from "../types";

const mockAuth: Partial<AuthService> = {
  issueTribeToken: jest.fn(),
  refreshToken: jest.fn(),
  getJwksJson: jest.fn(),
};

const mockRegistry: Partial<RegistryService> = {
  get: jest.fn(),
  validateEnvironmentSecret: jest.fn(),
  validateLegacySecret: jest.fn(),
  getOwnedServices: jest.fn(),
  getEffectiveConsumesForTribe: jest.fn(),
};

const mockLogger: Partial<LoggerService> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockKafka: Partial<KafkaService> = {
  publish: jest.fn().mockResolvedValue(undefined),
  publishNonBlocking: jest.fn(),
};

const mockConfig = {
  authProvider: "dev-jwt",
  environmentContract: {
    mode: "enforce" as "enforce" | "warn",
    legacyTribeSecretFallback: false,
    legacyAllowlist: [] as string[],
    legacyEnvironmentMap: {} as Record<string, "test" | "live">,
  },
};

function fakeReq(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  return { correlationId: "corr-1", ...overrides } as AuthenticatedRequest;
}

const activeTestEnvironment = {
  environment: "test" as const,
  baseUrl: "https://svc-alpha.test",
  status: "active" as const,
};

function activeService(serviceId = "svc-alpha") {
  return {
    serviceId,
    ownerTribeId: serviceId,
    requiredScopes: ["read"],
    consumes: [],
    environments: [activeTestEnvironment],
  };
}

describe("AuthController", () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockRegistry.validateLegacySecret as jest.Mock).mockResolvedValue(false);
    mockConfig.environmentContract = {
      mode: "enforce" as "enforce" | "warn",
      legacyTribeSecretFallback: false,
      legacyAllowlist: [],
      legacyEnvironmentMap: {},
    };
    (mockRegistry.getOwnedServices as jest.Mock).mockReturnValue([]);
    (mockRegistry.getEffectiveConsumesForTribe as jest.Mock).mockImplementation(
      (tribeId: string) => {
        const service = (mockRegistry.get as jest.Mock)(tribeId);
        return service?.consumes ?? [];
      },
    );
    controller = new AuthController(
      mockAuth as AuthService,
      mockRegistry as RegistryService,
      mockLogger as LoggerService,
      mockKafka as KafkaService,
      mockConfig as ConfigService,
    );
  });

  describe("issueToken()", () => {
    const dto = {
      tribeId: "svc-alpha",
      secret: "s3cret",
      environment: "test" as const,
    };

    it("returns accessToken, refreshToken, environment, and source service context", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        true,
      );
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: "refresh-jwt",
        expiresIn: 3600,
      });

      const result = await controller.issueToken(dto, fakeReq());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          accessToken: "access-jwt",
          refreshToken: "refresh-jwt",
          expiresIn: 3600,
          tribeId: "svc-alpha",
          sourceServiceId: "svc-alpha",
          environment: "test",
        }),
      );
      expect(mockRegistry.validateEnvironmentSecret).toHaveBeenCalledWith(
        "svc-alpha",
        "s3cret",
        "test",
      );
      expect(mockAuth.issueTribeToken).toHaveBeenCalledWith(
        "svc-alpha",
        expect.any(Array),
        expect.any(Array),
        expect.objectContaining({
          environment: "test",
          sourceServiceId: "svc-alpha",
        }),
      );
    });

    it("returns refreshToken as null when provider omits it", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        true,
      );
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: null,
        expiresIn: 3600,
      });

      const result = await controller.issueToken(dto, fakeReq());
      expect(result.data.refreshToken).toBeNull();
    });

    it("throws NotFoundError for unknown tribe", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(null);

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws UnauthorizedError for invalid secret", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        false,
      );

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(
        UnauthorizedError,
      );
    });
    it("rejects missing environment in enforce mode", async () => {
      await expect(
        controller.issueToken(
          { tribeId: "svc-alpha", secret: "s3cret" } as typeof dto,
          fakeReq(),
        ),
      ).rejects.toThrow("environment is required");
    });

    it("maps a missing environment only for warn-mode allowlisted legacy tribes", async () => {
      (mockRegistry.validateLegacySecret as jest.Mock).mockResolvedValue(false);
      mockConfig.environmentContract = {
        mode: "warn" as const,
        legacyTribeSecretFallback: true,
        legacyAllowlist: ["svc-alpha"],
        legacyEnvironmentMap: { "svc-alpha": "test" },
      };
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        true,
      );
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: "refresh-jwt",
        expiresIn: 3600,
      });

      const result = await controller.issueToken(
        { tribeId: "svc-alpha", secret: "s3cret" } as typeof dto,
        fakeReq(),
      );

      expect(result.data.environment).toBe("test");
      expect(mockRegistry.validateEnvironmentSecret).toHaveBeenCalledWith(
        "svc-alpha",
        "s3cret",
        "test",
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Legacy token request accepted without environment for svc-alpha as test",
        "AuthController",
      );
      const [, payload] = (mockKafka.publishNonBlocking as jest.Mock).mock
        .calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          environment: "test",
          legacyCompatibilityWarning: true,
        }),
      );
    });

    it("rejects missing environment in warn mode when no explicit legacy map exists", async () => {
      (mockRegistry.validateLegacySecret as jest.Mock).mockResolvedValue(false);
      mockConfig.environmentContract = {
        mode: "warn" as const,
        legacyTribeSecretFallback: true,
        legacyAllowlist: ["svc-alpha"],
        legacyEnvironmentMap: {},
      };

      await expect(
        controller.issueToken(
          { tribeId: "svc-alpha", secret: "s3cret" } as typeof dto,
          fakeReq(),
        ),
      ).rejects.toThrow("APICENTER_LEGACY_ENVIRONMENT_MAP");
    });

    it("uses the legacy secret fallback only after mapped environment validation fails", async () => {
      mockConfig.environmentContract = {
        mode: "warn" as const,
        legacyTribeSecretFallback: true,
        legacyAllowlist: ["svc-alpha"],
        legacyEnvironmentMap: { "svc-alpha": "test" },
      };
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        false,
      );
      (mockRegistry.validateLegacySecret as jest.Mock).mockResolvedValue(true);
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: "refresh-jwt",
        expiresIn: 3600,
      });

      const result = await controller.issueToken(
        { tribeId: "svc-alpha", secret: "legacy-secret" } as typeof dto,
        fakeReq(),
      );

      expect(result.data.environment).toBe("test");
      expect(mockRegistry.validateEnvironmentSecret).toHaveBeenCalledWith(
        "svc-alpha",
        "legacy-secret",
        "test",
      );
      expect(mockRegistry.validateLegacySecret).toHaveBeenCalledWith(
        "svc-alpha",
        "legacy-secret",
      );
      const [, payload] = (mockKafka.publishNonBlocking as jest.Mock).mock
        .calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          legacyCompatibilityWarning: true,
          legacySecretFallbackUsed: true,
        }),
      );
    });
    it("throws UnauthorizedError for an unknown source service", async () => {
      (mockRegistry.get as jest.Mock).mockImplementation((serviceId: string) =>
        serviceId === "svc-alpha" ? activeService("svc-alpha") : null,
      );

      await expect(
        controller.issueToken(
          { ...dto, sourceServiceId: "missing-source" },
          fakeReq(),
        ),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("throws ForbiddenError when source service belongs to another tribe", async () => {
      (mockRegistry.get as jest.Mock).mockImplementation(
        (serviceId: string) => {
          if (serviceId === "svc-alpha") return activeService("svc-alpha");
          if (serviceId === "billing-api") {
            return {
              ...activeService("billing-api"),
              ownerTribeId: "billing",
            };
          }
          return null;
        },
      );

      await expect(
        controller.issueToken(
          { ...dto, sourceServiceId: "billing-api" },
          fakeReq(),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws ForbiddenError when source service is not active in the requested environment", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue({
        ...activeService("svc-alpha"),
        environments: [
          {
            environment: "test",
            baseUrl: "https://svc-alpha.test",
            status: "deprecated",
          },
        ],
      });

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("publishes TOKEN_ISSUED Kafka event without raw JWT material", async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(activeService());
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        true,
      );
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: "refresh-jwt",
        expiresIn: 3600,
      });

      await controller.issueToken(dto, fakeReq());

      expect(mockKafka.publishNonBlocking).toHaveBeenCalledTimes(1);
      const [topic, payload, options] = (
        mockKafka.publishNonBlocking as jest.Mock
      ).mock.calls[0];
      expect(topic).toBe("api-center.auth.token-issued");
      expect(options.key).toBe("test:svc-alpha");
      expect(payload).toEqual(
        expect.objectContaining({
          tribeId: "svc-alpha",
          sourceServiceId: "svc-alpha",
          environment: "test",
          scopes: ["read"],
          expiresIn: 3600,
        }),
      );
      expect(payload.permissions).toEqual(
        expect.arrayContaining(["tribe:svc-alpha:read"]),
      );
      expect(JSON.stringify(payload)).not.toContain("access-jwt");
      expect(JSON.stringify(payload)).not.toContain("refresh-jwt");
    });

    it("issues scopes from tribe-owned microservices and effective consumes", async () => {
      (mockRegistry.get as jest.Mock).mockImplementation(
        (serviceId: string) => {
          if (serviceId === "logistics") {
            return {
              serviceId: "logistics",
              ownerTribeId: "logistics",
              requiredScopes: ["logistics:read"],
              consumes: ["kafka"],
              environments: [activeTestEnvironment],
            };
          }
          if (serviceId === "payment") {
            return {
              serviceId: "payment",
              serviceType: "shared",
              requiredScopes: ["payment:write"],
              consumes: [],
            };
          }
          return null;
        },
      );
      (mockRegistry.getOwnedServices as jest.Mock).mockReturnValue([
        {
          serviceId: "logistics",
          ownerTribeId: "logistics",
          requiredScopes: ["logistics:read"],
        },
        {
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          requiredScopes: ["orders:read"],
        },
      ]);
      (mockRegistry.getEffectiveConsumesForTribe as jest.Mock).mockReturnValue([
        "payment",
        "kafka",
      ]);
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(
        true,
      );
      (mockAuth.issueTribeToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: "refresh-jwt",
        expiresIn: 3600,
      });

      await controller.issueToken(
        { tribeId: "logistics", secret: "s3cret", environment: "test" },
        fakeReq(),
      );

      expect(mockAuth.issueTribeToken).toHaveBeenCalledWith(
        "logistics",
        expect.arrayContaining(["tribe:logistics:read"]),
        expect.arrayContaining([
          "logistics:read",
          "orders:read",
          "payment:write",
          "external:kafka:write",
        ]),
        expect.objectContaining({
          environment: "test",
          sourceServiceId: "logistics",
        }),
      );
    });
  });

  describe("refreshToken()", () => {
    it("returns accessToken AND refreshToken", async () => {
      (mockAuth.refreshToken as jest.Mock).mockResolvedValue({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      });

      const result = await controller.refreshToken(
        { refreshToken: "old-refresh" },
        fakeReq(),
      );

      expect(result.data.accessToken).toBe("new-access");
      expect(result.data.refreshToken).toBe("new-refresh");
    });

    it("returns refreshToken as null when provider omits it", async () => {
      (mockAuth.refreshToken as jest.Mock).mockResolvedValue({
        accessToken: "new-access",
        refreshToken: null,
        expiresIn: 3600,
      });

      const result = await controller.refreshToken(
        { refreshToken: "old-refresh" },
        fakeReq(),
      );

      expect(result.data.refreshToken).toBeNull();
    });
  });

  describe("getJwks()", () => {
    it("returns JWKS when provider supports in-process JWKS", () => {
      const mockJwks = {
        keys: [{ kty: "RSA", kid: "dev-key-1", use: "sig", alg: "RS256" }],
      };
      (mockAuth.getJwksJson as jest.Mock).mockReturnValue(mockJwks);

      const result = controller.getJwks();
      expect(result).toEqual(mockJwks);
    });

    it("throws NotFoundException when provider does not serve in-process JWKS", () => {
      (mockAuth.getJwksJson as jest.Mock).mockReturnValue(null);

      expect(() => controller.getJwks()).toThrow(NotFoundException);
    });
  });

  describe("legacy Google auth", () => {
    it("does not expose Google OAuth handlers from API Center", () => {
      expect("initiateGoogleLogin" in controller).toBe(false);
      expect("googleCallback" in controller).toBe(false);
    });
  });
});
