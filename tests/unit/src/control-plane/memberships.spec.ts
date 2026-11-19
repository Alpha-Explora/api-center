import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConfigService } from "../../../../apps/gateway/src/config/config.service";

describe("console sign-in memberships", () => {
  const rows = [
    { organizationId: "org-1", email: "dev@example.test", role: "developer", organization: { slug: "alpha", name: "Alpha" } },
    { organizationId: "org-2", email: "dev@example.test", role: "operator", organization: { slug: "beta", name: "Beta" } },
  ];
  const findMany = jest.fn().mockResolvedValue(rows);
  const organizations = jest.fn().mockResolvedValue([
    { id: "org-1", slug: "alpha", name: "Alpha" },
    { id: "org-3", slug: "gamma", name: "Gamma" },
  ]);
  const prisma = { organizationMember: { findMany }, organization: { findMany: organizations } } as unknown as PrismaService;
  const config = { platformAdminEmails: ["ops@example.test"] } as ConfigService;
  const people = new OrganizationPeopleService(prisma, {} as AuditEventsService, config);

  it("lists every organization the email belongs to, with normalized roles", async () => {
    await expect(people.membershipsOf("dev@example.test")).resolves.toEqual({
      email: "dev@example.test",
      platformAdmin: false,
      memberships: [
        { organizationId: "org-1", organizationSlug: "alpha", organizationName: "Alpha", role: "developer" },
        { organizationId: "org-2", organizationSlug: "beta", organizationName: "Beta", role: expect.any(String) },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "dev@example.test" } }));
  });

  it("marks platform operators and lists every active organization for them", async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(people.membershipsOf("ops@example.test")).resolves.toMatchObject({
      platformAdmin: true,
      memberships: [],
      organizations: [
        { organizationId: "org-1", organizationSlug: "alpha", organizationName: "Alpha" },
        { organizationId: "org-3", organizationSlug: "gamma", organizationName: "Gamma" },
      ],
    });
    expect(organizations).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active" } }));
  });

  it("does not list other organizations to members", async () => {
    organizations.mockClear();
    const result = await people.membershipsOf("dev@example.test");
    expect(result).not.toHaveProperty("organizations");
    expect(organizations).not.toHaveBeenCalled();
  });
});
