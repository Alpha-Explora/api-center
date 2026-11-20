// Platform operators administer organizations: list, create (with an optional first owner, who is
// sent an invite), rename, and suspend or reactivate. Members of an organization never reach these.

import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ForbiddenError } from "@shared/errors";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "./console-actor.guard";
import { hasPlatformAccess, type ConsoleActor } from "./console-access.policy";
import { actorOf, emailSchema, nameSchema, organizationIdSchema, parse, slugSchema } from "./console-request";
import { MemberInviteService } from "./member-invite.service";
import { OrganizationAdminService } from "./organization-admin.service";

const onBehalfOf = z.string().trim().min(1).max(200);

const schemas = {
  create: z.object({ name: nameSchema, slug: slugSchema, ownerEmail: emailSchema.optional(), actor: onBehalfOf.optional() }).strict(),
  rename: z
    .object({ name: nameSchema.optional(), slug: slugSchema.optional(), actor: onBehalfOf.optional() })
    .strict()
    .refine((value) => Boolean(value.name || value.slug), "name or slug is required"),
  status: z.object({ status: z.enum(["active", "suspended"]), actor: onBehalfOf.optional() }).strict(),
};

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class OrganizationAdminController {
  constructor(
    private readonly organizations: OrganizationAdminService,
    private readonly invites: MemberInviteService,
  ) {}

  @Get("organizations")
  async list(@Req() req: ConsoleRequest) {
    requirePlatform(actorOf(req));
    return { success: true, data: await this.organizations.list() };
  }

  @Post("organizations")
  async create(@Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = requirePlatform(actorOf(req));
    const input = parse(schemas.create, body, "body");
    const label = actorLabel(actor, input.actor);
    const organization = await this.organizations.create(input, label);
    const owner = input.ownerEmail
      ? {
          email: input.ownerEmail,
          role: "owner" as const,
          invite: await this.invites.invite({ organizationId: organization.id, email: input.ownerEmail, role: "owner", invitedBy: label }),
        }
      : null;
    return { success: true, data: { ...organization, owner } };
  }

  @Put("organizations/:organizationId")
  async rename(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = requirePlatform(actorOf(req));
    const org = parse(organizationIdSchema, organizationId, "organizationId");
    const input = parse(schemas.rename, body, "body");
    return { success: true, data: await this.organizations.rename(org, input, actorLabel(actor, input.actor)) };
  }

  @Put("organizations/:organizationId/status")
  async setStatus(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const actor = requirePlatform(actorOf(req));
    const org = parse(organizationIdSchema, organizationId, "organizationId");
    const input = parse(schemas.status, body, "body");
    return { success: true, data: await this.organizations.setStatus(org, input.status, actorLabel(actor, input.actor)) };
  }
}

function requirePlatform(actor: ConsoleActor): ConsoleActor {
  if (!hasPlatformAccess(actor)) throw new ForbiddenError("Organization administration is for platform operators");
  return actor;
}
