// Platform-admin API for the control plane. The management console calls it on behalf of a
// signed-in member and must pass that member as `actor`; a JWT caller's subject wins over it.

import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ValidationError } from "@shared/errors";
import type { AuthenticatedRequest } from "../../types";
import { ControlPlaneAdminService, type EnvironmentScope } from "./control-plane-admin.service";

const slug = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/, "must be lowercase letters, digits and hyphens");
const name = z.string().trim().min(1).max(128);
const actor = z.string().trim().min(1).max(200);

const schemas = {
  organizationId: z.string().uuid(),
  resourceId: (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{24}$`), `must be a ${prefix}_ identifier`),
  environment: z.enum(["test", "live"]),
  createProject: z.object({ slug, name, actor: actor.optional() }).strict(),
  setCapability: z.object({ enabled: z.boolean(), actor: actor.optional() }).strict(),
  createApplication: z.object({ slug, name, actor: actor.optional() }).strict(),
  grant: z.object({ capability: z.string().min(1).max(32), action: z.string().min(1).max(64), actor: actor.optional() }).strict(),
  issueCredential: z
    .object({ operationId: z.string().uuid(), expiresInDays: z.number().int().min(1).max(365).optional(), actor: actor.optional() })
    .strict(),
  revoke: z.object({ reason: z.string().trim().min(1).max(500), actor: actor.optional() }).strict(),
  actorOnly: z.object({ actor: actor.optional() }).strict(),
};

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${label}.${issue.path.join(".")}` : label;
    throw new ValidationError(`${path} ${issue?.message ?? "is invalid"}`);
  }
  return result.data;
}

@Controller("admin/control-plane")
@UseGuards(ScopedAdminGuard)
export class ControlPlaneAdminController {
  constructor(private readonly controlPlane: ControlPlaneAdminService) {}

  @Get("capabilities")
  capabilities() {
    return { success: true, data: this.controlPlane.listCapabilities() };
  }

  @Post("organizations/:organizationId/projects")
  async createProject(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.createProject, body, "body");
    const data = await this.controlPlane.createProject(
      parse(schemas.organizationId, organizationId, "organizationId"),
      input,
      resolveActor(req, input.actor),
    );
    return { success: true, data };
  }

  @Get("organizations/:organizationId/projects")
  async listProjects(@Param("organizationId") organizationId: string) {
    return { success: true, data: await this.controlPlane.listProjects(parse(schemas.organizationId, organizationId, "organizationId")) };
  }

  @Get("organizations/:organizationId/projects/:projectId")
  async getProject(@Param("organizationId") organizationId: string, @Param("projectId") projectId: string) {
    return {
      success: true,
      data: await this.controlPlane.getProject(
        parse(schemas.organizationId, organizationId, "organizationId"),
        parse(schemas.resourceId("prj"), projectId, "projectId"),
      ),
    };
  }

  @Put("organizations/:organizationId/projects/:projectId/environments/:environment/capabilities/:capability")
  async setCapability(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.setCapability, body, "body");
    const data = await this.controlPlane.setCapability(scopeFrom(params), params.capability, input.enabled, resolveActor(req, input.actor));
    return { success: true, data };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/:environment/applications")
  async createApplication(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.createApplication, body, "body");
    const data = await this.controlPlane.createApplication(scopeFrom(params), input, resolveActor(req, input.actor));
    return { success: true, data };
  }

  @Get("organizations/:organizationId/projects/:projectId/environments/:environment/applications")
  async listApplications(@Param() params: Record<string, string>) {
    return { success: true, data: await this.controlPlane.listApplications(scopeFrom(params)) };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/grants")
  async grant(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.grant, body, "body");
    const data = await this.controlPlane.grant(scopeFrom(params), applicationIdFrom(params), input, resolveActor(req, input.actor));
    return { success: true, data };
  }

  @Get("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/grants")
  async listGrants(@Param() params: Record<string, string>) {
    return { success: true, data: await this.controlPlane.listGrants(scopeFrom(params), applicationIdFrom(params)) };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/grants/:grantId/revoke")
  async revokeGrant(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.actorOnly, body, "body");
    const data = await this.controlPlane.revokeGrant(
      scopeFrom(params),
      applicationIdFrom(params),
      parse(schemas.resourceId("grt"), params.grantId, "grantId"),
      resolveActor(req, input.actor),
    );
    return { success: true, data };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/credentials")
  async issueCredential(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.issueCredential, body, "body");
    const data = await this.controlPlane.issueCredential(scopeFrom(params), applicationIdFrom(params), input, resolveActor(req, input.actor));
    return { success: true, data };
  }

  @Get("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/credentials")
  async listCredentials(@Param() params: Record<string, string>) {
    return { success: true, data: await this.controlPlane.listCredentials(scopeFrom(params), applicationIdFrom(params)) };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/:environment/applications/:applicationId/credentials/:credentialId/revoke")
  async revokeCredential(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = parse(schemas.revoke, body, "body");
    const data = await this.controlPlane.revokeCredential(
      scopeFrom(params),
      applicationIdFrom(params),
      parse(schemas.resourceId("crd"), params.credentialId, "credentialId"),
      input.reason,
      resolveActor(req, input.actor),
    );
    return { success: true, data };
  }
}

function scopeFrom(params: Record<string, string>): EnvironmentScope {
  return {
    organizationId: parse(schemas.organizationId, params.organizationId, "organizationId"),
    projectId: parse(schemas.resourceId("prj"), params.projectId, "projectId"),
    environmentKind: parse(schemas.environment, params.environment, "environment"),
  };
}

function applicationIdFrom(params: Record<string, string>): string {
  return parse(schemas.resourceId("app"), params.applicationId, "applicationId");
}

function resolveActor(req: AuthenticatedRequest, bodyActor: string | undefined): string {
  const resolved = req.user?.sub ?? bodyActor;
  if (!resolved) throw new ValidationError("actor is required when the caller is not a signed-in administrator");
  return resolved;
}
