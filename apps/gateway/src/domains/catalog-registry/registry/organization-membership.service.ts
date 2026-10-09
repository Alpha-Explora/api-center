import { Injectable } from "@nestjs/common";
import { ConfigService } from "@config/config.service";
import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from "@shared/dto/organization-membership.dto";
import { NotFoundError, ServiceUnavailableError, ValidationError } from "@shared/errors";
import {
  PostgresOrganizationMembershipStoreService,
  type MembershipRow,
  type OrganizationMemberRow,
} from "./postgres-organization-membership-store.service";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MembershipLookup {
  email: string;
  platformAdmin: boolean;
  memberships: MembershipRow[];
}

/**
 * Who may use the management console. Platform admins (PLATFORM_ADMIN_EMAILS) act as admin in every
 * organization; everyone else gets only the rows in apic_catalog.organization_members.
 */
@Injectable()
export class OrganizationMembershipService {
  constructor(
    private readonly config: ConfigService,
    private readonly store: PostgresOrganizationMembershipStoreService,
  ) {}

  async lookupByEmail(rawEmail: unknown): Promise<MembershipLookup> {
    const email = normalizeEmail(rawEmail);
    this.requireDatabase();
    const memberships = await this.store.findMembershipsByEmail(email);
    return {
      email,
      platformAdmin: this.config.platformAdminEmails.includes(email),
      memberships,
    };
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRow[]> {
    await this.requireOrganization(organizationId);
    return this.store.listMembers(organizationId);
  }

  async upsertMember(
    organizationId: string,
    input: { email: unknown; role: unknown },
    actor: string,
  ): Promise<OrganizationMemberRow> {
    const email = normalizeEmail(input.email);
    if (!isOrganizationRole(input.role)) {
      throw new ValidationError("role must be admin, operator, or observer");
    }
    await this.requireOrganization(organizationId);
    return this.store.upsertMember({
      organizationId,
      email,
      role: input.role,
      createdBy: actor,
    });
  }

  async removeMember(organizationId: string, rawEmail: unknown): Promise<{ email: string }> {
    const email = normalizeEmail(rawEmail);
    await this.requireOrganization(organizationId);
    const removed = await this.store.deleteMember(organizationId, email);
    if (!removed) {
      throw new NotFoundError(`${email} is not a member of organization '${organizationId}'`);
    }
    return { email };
  }

  private requireDatabase(): void {
    if (!this.config.database.enabled) {
      throw new ServiceUnavailableError(
        "Organization memberships need DATABASE_ENABLED=true; sign-in is unavailable",
      );
    }
  }

  private async requireOrganization(organizationId: string): Promise<void> {
    if (!UUID_PATTERN.test(organizationId)) {
      throw new ValidationError("organizationId must be a UUID");
    }
    this.requireDatabase();
    const organization = await this.store.findOrganization(organizationId);
    if (!organization) {
      throw new NotFoundError(`Organization '${organizationId}' is not registered`);
    }
  }
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("email must be a valid email address");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("email must be a valid email address");
  }
  return email;
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}
