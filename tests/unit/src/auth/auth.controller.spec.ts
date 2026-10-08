import { NotFoundException } from "@nestjs/common";
import { AuthController } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.controller";
import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import type { TenancyDirectory } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../../../apps/gateway/src/shared/errors";
import { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

const mockAuth: Partial<AuthService> = {
  issueServiceToken: jest.fn(),
  refreshToken: jest.fn(),
  getJwksJson: jest.fn(),
};

const mockRegistry: Partial<RegistryService> = {
  get: jest.fn(),
  validateEnvironmentSecret: jest.fn(),
  getCallableServiceIds: jest.fn(),
};

const placements: Record<string, { tribeId: string; status?: string; tribeStatus?: string }> = {
  "orders-core": { tribeId: "commerce" },
  "billing-core": { tribeId: "commerce" },
  "paused-project": { tribeId: "commerce", status: "suspended" },
};

const mockTenancy: TenancyDirectory = {
  getTribe: jest.fn(),
  resolveProject: jest.fn(),
  resolveServicePlacement: jest.fn(),
  requireActiveProject: jest.fn((projectId?: string) => {
    const placement = projectId ? placements[projectId] : undefined;
    if (!projectId) throw new ValidationError("projectId is required for tribe services");
    if (!placement) throw new ValidationError(`Project '${projectId}' is not registered`);
    if (placement.status && placement.status !== "active") {
      throw new ValidationError(`Project '${projectId}' is ${placement.status}`);
    }
    return {
      tribe: { tribeId: placement.tribeId, name: placement.tribeId, status: "active", createdAt: "", updatedAt: "" },
      project: { projectId, tribeId: placement.tribeId, name: projectId, status: "active", createdAt: "", updatedAt: "" },
    } as never;
  }),
};

const mockLogger: Partial<LoggerService> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockConfig = {
  authProvider: "dev-jwt",
  environmentContract: {
    mode: "enforce" as const,
  },
};

function fakeReq(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  return { correlationId: "corr-1", ...overrides } as AuthenticatedRequest;
}

const activeTestEnvironment = {
  environment: "test" as const,
  baseUrl: "https://orders-api.test",
  status: "active" as const,
};

function tribeService(serviceId: string, projectId: string, extra: Record<string, unknown> = {}) {
  return {
    serviceId,
    serviceType: "tribe",
    projectId,
    ownerTribeId: placements[projectId]?.tribeId,
    requiredScopes: [`${serviceId}:read`],
    consumes: [],
    environments: [activeTestEnvironment],
    ...extra,
  };
}

const services: Record<string, unknown> = {
  "orders-api": tribeService("orders-api", "orders-core", { consumes: ["payment", "kafka"] }),
  "orders-worker": tribeService("orders-worker", "orders-core"),
  "billing-api": tribeService("billing-api", "billing-core", { consumes: ["email"] }),
  payment: { serviceId: "payment", serviceType: "shared", requiredScopes: ["payment:write"], consumes: [] },
  email: { serviceId: "email", serviceType: "shared", requiredScopes: ["email:send"], consumes: [] },
};

describe("AuthController", () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.environmentContract = {
      mode: "enforce" as const,
    };
    (mockRegistry.get as jest.Mock).mockImplementation(
      (serviceId: string) => services[serviceId] ?? null,
    );
    (mockRegistry.getCallableServiceIds as jest.Mock).mockImplementation((serviceId: string) => {
      if (serviceId === "orders-api") return ["orders-api", "orders-worker", "payment", "kafka"];
      if (serviceId === "billing-api") return ["billing-api", "email"];
      return [serviceId];
    });
    (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(true);
    (mockAuth.issueServiceToken as jest.Mock).mockResolvedValue({
      accessToken: "access-jwt",
      refreshToken: "refresh-jwt",
      expiresIn: 3600,
    });
    controller = new AuthController(
      mockAuth as AuthService,
      mockRegistry as RegistryService,
      mockTenancy,
      mockLogger as LoggerService,
      mockConfig as unknown as ConfigService,
    );
  });

  describe("issueToken()", () => {
    const dto = {
      serviceId: "orders-api",
      secret: "s3cret",
      environment: "test" as const,
    };

    it("issues a token bound to the service, its project, and its tribe", async () => {
      const result = await controller.issueToken(dto, fakeReq());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          accessToken: "access-jwt",
          refreshToken: "refresh-jwt",
          expiresIn: 3600,
          serviceId: "orders-api",
          projectId: "orders-core",
          tribeId: "commerce",
          environment: "test",
        }),
      );
      expect(mockRegistry.validateEnvironmentSecret).toHaveBeenCalledWith(
        "orders-api",
        "s3cret",
        "test",
      );
      expect(mockAuth.issueServiceToken).toHaveBeenCalledWith(
        { serviceId: "orders-api", projectId: "orders-core", tribeId: "commerce" },
        expect.arrayContaining(["service:orders-api:read"]),
        expect.any(Array),
        "test",
      );
    });

    it("returns refreshToken as null when provider omits it", async () => {
      (mockAuth.issueServiceToken as jest.Mock).mockResolvedValue({
        accessToken: "access-jwt",
        refreshToken: null,
        expiresIn: 3600,
      });

      const result = await controller.issueToken(dto, fakeReq());
      expect(result.data.refreshToken).toBeNull();
    });

    it("scopes the token to project siblings and the service's own consumes only", async () => {
      await controller.issueToken(dto, fakeReq());

      const scopes = (mockAuth.issueServiceToken as jest.Mock).mock.calls[0][2] as string[];
      expect(scopes).toEqual(
        expect.arrayContaining([
          "orders-api:read",
          "orders-worker:read",
          "payment:write",
          "external:kafka:write",
        ]),
      );
      expect(scopes).not.toContain("billing-api:read");
      expect(scopes).not.toContain("email:send");
    });

    it("throws NotFoundError for an unknown service", async () => {
      await expect(
        controller.issueToken({ ...dto, serviceId: "missing" }, fakeReq()),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws UnauthorizedError for an invalid secret", async () => {
      (mockRegistry.validateEnvironmentSecret as jest.Mock).mockResolvedValue(false);

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(
        UnauthorizedError,
      );
      expect(mockAuth.issueServiceToken).not.toHaveBeenCalled();
    });

    it("rejects missing environment in enforce mode", async () => {
      await expect(
        controller.issueToken(
          { serviceId: "orders-api", secret: "s3cret" } as typeof dto,
          fakeReq(),
        ),
      ).rejects.toThrow("environment is required");
    });

    it("refuses shared platform services", async () => {
      await expect(
        controller.issueToken({ ...dto, serviceId: "payment" }, fakeReq()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses services in a suspended project", async () => {
      services["paused-api"] = tribeService("paused-api", "paused-project");

      await expect(
        controller.issueToken({ ...dto, serviceId: "paused-api" }, fakeReq()),
      ).rejects.toThrow("Service 'paused-api' cannot receive tokens: Project 'paused-project' is suspended");
    });

    it("refuses services whose stored tribe disagrees with their project", async () => {
      services["drifted-api"] = { ...tribeService("drifted-api", "orders-core"), ownerTribeId: "other" };

      await expect(
        controller.issueToken({ ...dto, serviceId: "drifted-api" }, fakeReq()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses services that are not active in the requested environment", async () => {
      services["test-only"] = tribeService("test-only", "orders-core", {
        environments: [{ environment: "test", baseUrl: "https://t", status: "deprecated" }],
      });

      await expect(
        controller.issueToken({ ...dto, serviceId: "test-only" }, fakeReq()),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("refreshToken()", () => {
    const subject = { serviceId: "orders-api", environment: "test", projectId: "orders-core" };
    const runRevalidation = (override: Partial<typeof subject> = {}) =>
      (mockAuth.refreshToken as jest.Mock).mockImplementation(
        async (_token: string, revalidate: (s: typeof subject) => unknown) => {
          const grant = revalidate({ ...subject, ...override });
          return { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600, grant };
        },
      );

    it("returns accessToken AND refreshToken", async () => {
      runRevalidation();

      const result = await controller.refreshToken(
        { refreshToken: "old-refresh" },
        fakeReq(),
      );

      expect(result.data.accessToken).toBe("new-access");
      expect(result.data.refreshToken).toBe("new-refresh");
    });

    it("recomputes scopes from the registry as it stands now", async () => {
      runRevalidation();
      await controller.refreshToken({ refreshToken: "old-refresh" }, fakeReq());

      const [, revalidate] = (mockAuth.refreshToken as jest.Mock).mock.calls[0];
      expect(revalidate(subject)).toMatchObject({
        identity: { serviceId: "orders-api", projectId: "orders-core", tribeId: "commerce" },
        scopes: expect.arrayContaining(["orders-api:read", "orders-worker:read", "payment:write"]),
      });
    });

    it("refuses a refresh when the project is suspended", async () => {
      (services["orders-api"] as { projectId: string }).projectId = "paused-project";
      try {
        runRevalidation({ projectId: "paused-project" });
        await expect(
          controller.refreshToken({ refreshToken: "old-refresh" }, fakeReq()),
        ).rejects.toThrow(ForbiddenError);
      } finally {
        (services["orders-api"] as { projectId: string }).projectId = "orders-core";
      }
    });

    it("refuses a refresh when the service has left its project", async () => {
      runRevalidation({ projectId: "billing-core" });
      await expect(
        controller.refreshToken({ refreshToken: "old-refresh" }, fakeReq()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses a refresh when the service is no longer active in the environment", async () => {
      runRevalidation({ environment: "live" });
      await expect(
        controller.refreshToken({ refreshToken: "old-refresh" }, fakeReq()),
      ).rejects.toThrow(ForbiddenError);
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
