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
  const prisma = { organizationMember: { findMany } } as unknown as PrismaService;
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

  it("marks platform operators", async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(people.membershipsOf("ops@example.test")).resolves.toMatchObject({ platformAdmin: true, memberships: [] });
  });
});
