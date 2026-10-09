import { OrganizationMembershipController } from "../../../../apps/gateway/src/domains/catalog-registry/registry/organization-membership.controller";
import type { OrganizationMembershipService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/organization-membership.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";

const ORG_ID = "6f1c2a4e-1111-4a2b-9c3d-0123456789ab";

describe("OrganizationMembershipController", () => {
  let memberships: Record<string, jest.Mock>;
  let audit: { recordRequired: jest.Mock };
  let controller: OrganizationMembershipController;

  beforeEach(() => {
    memberships = {
      lookupByEmail: jest.fn(),
      listMembers: jest.fn(),
      upsertMember: jest.fn(),
      removeMember: jest.fn(),
    };
    audit = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    controller = new OrganizationMembershipController(
      memberships as unknown as OrganizationMembershipService,
      audit as unknown as AuditEventsService,
    );
  });

  const req = { correlationId: "corr-1", user: { sub: "ops@example.com" } } as any;

  it("returns a lookup in the standard response envelope", async () => {
    const lookup = { email: "dana@acme.example", platformAdmin: false, memberships: [] };
    memberships.lookupByEmail.mockResolvedValue(lookup);

    const response = await controller.lookup("dana@acme.example", req);

    expect(response).toMatchObject({ success: true, data: lookup, meta: { correlationId: "corr-1" } });
  });

  it("audits an added or updated member with the acting admin as the actor", async () => {
    memberships.upsertMember.mockResolvedValue({
      organizationId: ORG_ID,
      email: "dana@acme.example",
      role: "observer",
    });

    await controller.upsertMember(ORG_ID, "dana@acme.example", { role: "observer" }, req);

    expect(audit.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "organization.member.upserted",
        actionFamily: "policy",
        actor: "ops@example.com",
        resourceType: "organization",
        resourceId: ORG_ID,
        payload: { email: "dana@acme.example", role: "observer" },
      }),
    );
  });

  it("audits a removed member", async () => {
    memberships.removeMember.mockResolvedValue({ email: "dana@acme.example" });

    await controller.removeMember(ORG_ID, "dana@acme.example", req);

    expect(audit.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "organization.member.removed",
        resourceId: ORG_ID,
        payload: { email: "dana@acme.example" },
      }),
    );
  });

  it("fails the request when the audit event cannot be written", async () => {
    memberships.removeMember.mockResolvedValue({ email: "dana@acme.example" });
    audit.recordRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(controller.removeMember(ORG_ID, "dana@acme.example", req)).rejects.toThrow(
      "audit unavailable",
    );
  });
});
