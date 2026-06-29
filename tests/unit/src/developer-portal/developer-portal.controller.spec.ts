import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../../../../src/auth/guards/jwt-auth.guard";
import { ForbiddenError } from "../../../../src/shared/errors";
import { DeveloperPortalController } from "../../../../src/developer-portal/developer-portal.controller";

describe("DeveloperPortalController", () => {
  const registry = {
    getDeveloperPortalServices: jest.fn(),
  };
  const quotas = {
    listPoliciesForPortal: jest.fn(),
  };
  let controller: DeveloperPortalController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DeveloperPortalController(registry as any, quotas as any);
    registry.getDeveloperPortalServices.mockReturnValue({
      ownedServices: [
        {
          serviceId: "campus-one",
          name: "Campus One",
          routes: ["/students"],
          scopes: ["students:read"],
          status: "active",
        },
      ],
      allowedServices: [
        {
          serviceId: "payment-service",
          name: "Payments",
          routes: ["/payments"],
          scopes: ["payments:write"],
          status: "active",
        },
      ],
    });
    quotas.listPoliciesForPortal.mockResolvedValue([
      {
        id: "quota-1",
        ownerTribeId: "campus-one",
        scope: "all",
        targetServiceId: null,
        windowSeconds: 86400,
        maxRequests: 25000,
        mode: "observe",
        status: "active",
        reason: "Plan default",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
  });

  it("uses JWT auth for all portal routes", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DeveloperPortalController,
    );

    expect(guards).toContain(JwtAuthGuard);
  });

  it("returns caller profile from the JWT tribeId", () => {
    const response = controller.me(
      request({ tribeId: "campus-one", scopes: ["external:kafka:read"] }),
    );

    expect(response.data).toEqual({
      tribeId: "campus-one",
      scopes: ["external:kafka:read"],
    });
  });

  it("returns only services visible to the caller tribe", () => {
    const response = controller.services(request({ tribeId: "campus-one" }));

    expect(registry.getDeveloperPortalServices).toHaveBeenCalledWith(
      "campus-one",
    );
    expect(response.data.allowedServices[0]).not.toHaveProperty("baseUrl");
  });

  it("returns caller-scoped quota policies without query overrides", async () => {
    const response = await controller.quotas(
      request({ tribeId: "campus-one" }),
    );

    expect(quotas.listPoliciesForPortal).toHaveBeenCalledWith("campus-one");
    expect(response.data[0]).not.toHaveProperty("createdBy");
  });

  it("returns tenant-scoped topic guidance", () => {
    const response = controller.topics(request({ tribeId: "campus-one" }));

    expect(response.data.tenantTopicPrefix).toBe("tribe.campus-one.");
    expect(response.data.recommendedTopics).toContain(
      "tribe.campus-one.events",
    );
  });

  it("returns onboarding state without plaintext secrets", async () => {
    const response = await controller.onboarding(
      request({ tribeId: "campus-one" }),
    );

    expect(response.data.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "quota_policy",
          complete: true,
        }),
      ]),
    );
    expect(JSON.stringify(response.data)).not.toContain("secret");
  });

  it("rejects requests that do not have a tribeId claim", () => {
    expect(() => controller.me(request({ tribeId: undefined }))).toThrow(
      ForbiddenError,
    );
  });
});

function request(input: { tribeId?: string; scopes?: string[] }) {
  return {
    tribeId: input.tribeId,
    user: {
      tribeId: input.tribeId,
      scopes: input.scopes ?? [],
    },
    correlationId: "corr-portal",
  } as any;
}
