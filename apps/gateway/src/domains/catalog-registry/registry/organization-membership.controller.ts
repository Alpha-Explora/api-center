// =============================================================================
// Organization membership admin API: who may sign in to the management console.
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { AuditEventsService } from "@audit/audit-events.service";
import { UpsertOrganizationMemberDto } from "@shared/dto/organization-membership.dto";
import type { AuthenticatedRequest } from "../../../types";
import { OrganizationMembershipService } from "./organization-membership.service";

@Controller("admin")
@UseGuards(ScopedAdminGuard)
export class OrganizationMembershipController {
  constructor(
    private readonly memberships: OrganizationMembershipService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  @Get("memberships")
  async lookup(@Query("email") email: string, @Req() req: AuthenticatedRequest) {
    return this.response(await this.memberships.lookupByEmail(email), req);
  }

  @Get("organizations/:organizationId/members")
  async listMembers(
    @Param("organizationId") organizationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.response(await this.memberships.listMembers(organizationId), req);
  }

  @Put("organizations/:organizationId/members/:email")
  async upsertMember(
    @Param("organizationId") organizationId: string,
    @Param("email") email: string,
    @Body() body: UpsertOrganizationMemberDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const member = await this.memberships.upsertMember(
      organizationId,
      { email, role: body.role },
      actorOf(req),
    );
    await this.audit(req, "organization.member.upserted", organizationId, {
      email: member.email,
      role: member.role,
    });
    return this.response(member, req);
  }

  @Delete("organizations/:organizationId/members/:email")
  async removeMember(
    @Param("organizationId") organizationId: string,
    @Param("email") email: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.memberships.removeMember(organizationId, email);
    await this.audit(req, "organization.member.removed", organizationId, {
      email: result.email,
    });
    return this.response(result, req);
  }

  private async audit(
    req: AuthenticatedRequest,
    type: string,
    organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditEvents.recordRequired({
      type,
      actionFamily: "policy",
      actor: actorOf(req),
      resourceType: "organization",
      resourceId: organizationId,
      environment: "live",
      correlationId: req.correlationId ?? organizationId,
      severity: "info",
      message: `${type} for ${organizationId}`,
      payload,
    });
  }

  private response<T>(data: T, req: AuthenticatedRequest) {
    return {
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}

function actorOf(req: AuthenticatedRequest): string {
  return req.user?.sub ?? req.tribeId ?? "platform-admin";
}
