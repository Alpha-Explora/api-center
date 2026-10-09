import { ServiceSpecService } from "../../../../apps/gateway/src/domains/catalog-registry/catalog/service-spec.service";
import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";

describe("ServiceSpecService identity scoping", () => {
  const document = { openapi: "3.1.0", paths: {} };
  const firstService = {
    id: "11111111-1111-4111-8111-111111111111",
    serviceId: "billing-api",
    projectId: "project-a",
  };
  const secondService = {
    id: "22222222-2222-4222-8222-222222222222",
    serviceId: "billing-api",
    projectId: "project-b",
  };

  function createService(prisma: Record<string, unknown>) {
    return new ServiceSpecService(prisma as unknown as PrismaService);
  }

  it("lists duplicate slugs as separate organization and service identities", async () => {
    const prisma = {
      service: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: firstService.id,
            organizationId: "org-a",
            serviceId: firstService.serviceId,
            name: "Billing A",
            serviceType: "tribe",
            status: "active",
            projectId: firstService.projectId,
            ownerTribeId: "tribe-a",
            ownerTeam: null,
            contact: null,
            serviceTier: "standard",
            organization: { name: "Organization A", slug: "org-a" },
            project: { name: "Project A", tribe: { name: "Tribe A" } },
            scopes: [{ scope: "billing:read" }],
            routes: [{ path: "/billing" }],
          },
          {
            id: secondService.id,
            organizationId: "org-b",
            serviceId: secondService.serviceId,
            name: "Billing B",
            serviceType: "tribe",
            status: "active",
            projectId: secondService.projectId,
            ownerTribeId: "tribe-b",
            ownerTeam: null,
            contact: null,
            serviceTier: "standard",
            organization: { name: "Organization B", slug: "org-b" },
            project: { name: "Project B", tribe: { name: "Tribe B" } },
            scopes: [{ scope: "billing:write" }],
            routes: [{ path: "/billing" }],
          },
        ]),
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              where.id === firstService.id ? firstService : secondService,
            ),
          ),
      },
      serviceSpecVersion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    const catalog = await service.listCatalogServices();
    await service.list(firstService.id);
    await service.list(secondService.id);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstService.id,
          organizationId: "org-a",
          serviceId: "billing-api",
          projectId: "project-a",
        }),
        expect.objectContaining({
          id: secondService.id,
          organizationId: "org-b",
          serviceId: "billing-api",
          projectId: "project-b",
        }),
      ]),
    );
    expect(prisma.serviceSpecVersion.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { serviceId: firstService.id } }),
    );
    expect(prisma.serviceSpecVersion.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { serviceId: secondService.id } }),
    );
  });

  it("rejects a token whose project does not own the selected service identity", async () => {
    const prisma = {
      service: { findUnique: jest.fn().mockResolvedValue(firstService) },
      serviceSpecVersion: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    const service = createService(prisma);

    await expect(
      service.publish(
        firstService.id,
        "billing-api",
        { version: "1.0.0", format: "openapi-3.1", document },
        { serviceId: "billing-api", projectId: "project-b" },
      ),
    ).rejects.toThrow("authenticated project");
    expect(prisma.serviceSpecVersion.create).not.toHaveBeenCalled();
  });

  it("stores duplicate service slugs against their selected UUIDs", async () => {
    const prisma = {
      service: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              where.id === firstService.id ? firstService : secondService,
            ),
          ),
      },
      serviceSpecVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: unknown }) =>
            Promise.resolve(data),
          ),
      },
    };
    const service = createService(prisma);

    await service.publish(firstService.id, "admin", {
      version: "1.0.0",
      format: "openapi-3.1",
      document,
    });
    await service.publish(secondService.id, "admin", {
      version: "1.0.0",
      format: "openapi-3.1",
      document: { ...document, info: { title: "Organization B" } },
    });

    expect(prisma.serviceSpecVersion.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ serviceId: firstService.id }),
      }),
    );
    expect(prisma.serviceSpecVersion.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ serviceId: secondService.id }),
      }),
    );
  });
});
