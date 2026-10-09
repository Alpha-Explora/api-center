import { OrganizationMembershipService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/organization-membership.service";
import type { PostgresOrganizationMembershipStoreService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/postgres-organization-membership-store.service";
import type { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../../../../apps/gateway/src/shared/errors";

const ORG_ID = "6f1c2a4e-1111-4a2b-9c3d-0123456789ab";
const ACTOR = "platform-admin";

function config(overrides: { enabled?: boolean; platformAdminEmails?: string[] } = {}) {
  return {
    database: { enabled: overrides.enabled ?? true },
    platformAdminEmails: overrides.platformAdminEmails ?? [],
  } as unknown as ConfigService;
}

function store(overrides: Record<string, jest.Mock> = {}) {
  return {
    findOrganization: jest.fn().mockResolvedValue({ id: ORG_ID, slug: "acme", name: "Acme" }),
    findMembershipsByEmail: jest.fn().mockResolvedValue([]),
    listMembers: jest.fn().mockResolvedValue([]),
    upsertMember: jest.fn(),
    deleteMember: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as PostgresOrganizationMembershipStoreService & Record<string, jest.Mock>;
}

describe("OrganizationMembershipService", () => {
  describe("lookupByEmail", () => {
    it("returns the memberships for a member, matching the email case-insensitively", async () => {
      const membershipRows = [
        { organizationId: ORG_ID, organizationSlug: "acme", organizationName: "Acme", role: "operator" },
      ];
      const s = store({ findMembershipsByEmail: jest.fn().mockResolvedValue(membershipRows) });
      const service = new OrganizationMembershipService(config(), s);

      const result = await service.lookupByEmail("  Dana@Acme.Example ");

      expect(s.findMembershipsByEmail).toHaveBeenCalledWith("dana@acme.example");
      expect(result).toEqual({
        email: "dana@acme.example",
        platformAdmin: false,
        memberships: membershipRows,
      });
    });

    it("returns no memberships and no platform admin flag for an unknown account", async () => {
      const service = new OrganizationMembershipService(config(), store());

      await expect(service.lookupByEmail("stranger@example.com")).resolves.toEqual({
        email: "stranger@example.com",
        platformAdmin: false,
        memberships: [],
      });
    });

    it("flags a platform admin from PLATFORM_ADMIN_EMAILS even without a membership row", async () => {
      const service = new OrganizationMembershipService(
        config({ platformAdminEmails: ["ops@example.com"] }),
        store(),
      );

      expect((await service.lookupByEmail("OPS@example.com")).platformAdmin).toBe(true);
    });

    it("rejects a malformed email before touching the store", async () => {
      const s = store();
      const service = new OrganizationMembershipService(config(), s);

      await expect(service.lookupByEmail("not-an-email")).rejects.toThrow(ValidationError);
      expect(s.findMembershipsByEmail).not.toHaveBeenCalled();
    });

    it("fails with service unavailable when the database is not enabled", async () => {
      const service = new OrganizationMembershipService(config({ enabled: false }), store());

      await expect(service.lookupByEmail("dana@acme.example")).rejects.toThrow(ServiceUnavailableError);
    });
  });

  describe("upsertMember", () => {
    it("adds a member with a lowercase email and records the acting admin as creator", async () => {
      const row = {
        organizationId: ORG_ID,
        email: "dana@acme.example",
        role: "admin",
        createdBy: ACTOR,
        createdAt: "2026-10-09T00:00:00.000Z",
      };
      const s = store({ upsertMember: jest.fn().mockResolvedValue(row) });
      const service = new OrganizationMembershipService(config(), s);

      const result = await service.upsertMember(
        ORG_ID,
        { email: "Dana@Acme.Example", role: "admin" },
        ACTOR,
      );

      expect(s.upsertMember).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        email: "dana@acme.example",
        role: "admin",
        createdBy: ACTOR,
      });
      expect(result).toEqual(row);
    });

    it("rejects a role outside admin, operator, and observer", async () => {
      const s = store();
      const service = new OrganizationMembershipService(config(), s);

      await expect(
        service.upsertMember(ORG_ID, { email: "dana@acme.example", role: "owner" }, ACTOR),
      ).rejects.toThrow("role must be admin, operator, or observer");
      expect(s.upsertMember).not.toHaveBeenCalled();
    });

    it("rejects an organization id that is not a UUID", async () => {
      const service = new OrganizationMembershipService(config(), store());

      await expect(
        service.upsertMember("acme", { email: "dana@acme.example", role: "observer" }, ACTOR),
      ).rejects.toThrow(ValidationError);
    });

    it("reports a missing organization instead of creating an orphan membership", async () => {
      const s = store({ findOrganization: jest.fn().mockResolvedValue(null) });
      const service = new OrganizationMembershipService(config(), s);

      await expect(
        service.upsertMember(ORG_ID, { email: "dana@acme.example", role: "observer" }, ACTOR),
      ).rejects.toThrow(NotFoundError);
      expect(s.upsertMember).not.toHaveBeenCalled();
    });
  });

  describe("removeMember", () => {
    it("removes an existing member", async () => {
      const service = new OrganizationMembershipService(config(), store());

      await expect(service.removeMember(ORG_ID, "Dana@Acme.Example")).resolves.toEqual({
        email: "dana@acme.example",
      });
    });

    it("returns not found when the email has no membership in that organization", async () => {
      const service = new OrganizationMembershipService(
        config(),
        store({ deleteMember: jest.fn().mockResolvedValue(false) }),
      );

      await expect(service.removeMember(ORG_ID, "dana@acme.example")).rejects.toThrow(NotFoundError);
    });
  });
});
