// Console API for the control plane. Every route resolves a ConsoleActor (ConsoleActorGuard) and
// checks console-access.policy before running a use case. The management console forwards the
// signed-in member's Google ID token so their roles apply; a platform caller without a user
// token acts as the platform.

import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@shared/errors";
import { ControlPlaneAdminService, type EnvironmentScope } from "./control-plane-admin.service";
import { ConsoleAccessService } from "./console-access.service";
import { OrganizationPeopleService } from "./organization-people.service";
import { QuotaService } from "./quota.service";
import { LiveEnvironmentService } from "./live-environment.service";
import { CapabilityConfigurationService } from "./capability-configuration.service";
import { ConsoleActorGuard, actorLabel, type ConsoleRequest } from "./console-actor.guard";
import { effectiveProjectRole, hasPlatformAccess, type ConsoleActor } from "./console-access.policy";

const slug = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/, "must be lowercase letters, digits and hyphens");
const name = z.string().trim().min(1).max(128);
const onBehalfOf = z.string().trim().min(1).max(200);
const email = z.string().trim().toLowerCase().email().max(320);

const schemas = {
  organizationId: z.string().uuid(),
  resourceId: (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{24}$`), `must be a ${prefix}_ identifier`),
  environment: z.enum(["test", "live"]),
  email,
  createProject: z.object({ slug, name, actor: onBehalfOf.optional() }).strict(),
  setCapability: z.object({ enabled: z.boolean(), actor: onBehalfOf.optional() }).strict(),
  createApplication: z.object({ slug, name, actor: onBehalfOf.optional() }).strict(),
  grant: z.object({ capability: z.string().min(1).max(32), action: z.string().min(1).max(64), actor: onBehalfOf.optional() }).strict(),
  issueCredential: z
    .object({ operationId: z.string().uuid(), expiresInDays: z.number().int().min(1).max(365).optional(), actor: onBehalfOf.optional() })
    .strict(),
  revoke: z.object({ reason: z.string().trim().min(1).max(500), actor: onBehalfOf.optional() }).strict(),
  actorOnly: z.object({ actor: onBehalfOf.optional() }).strict(),
  assignPlan: z.object({ planKey: z.string().min(1).max(32), actor: onBehalfOf.optional() }).strict(),
  quotaPolicy: z
    .object({
      environmentKind: z.enum(["test", "live"]),
      capability: z.string().min(1).max(32).optional(),
      windowSeconds: z.number().int().min(1).max(2_678_400),
      maxRequests: z.number().int().min(1).max(2_000_000_000),
      mode: z.enum(["observe", "enforce"]).default("enforce"),
      actor: onBehalfOf.optional(),
    })
    .strict(),
  sharedQuotaPolicy: z
    .object({
      projectIds: z.array(z.string().regex(/^prj_[a-z0-9]{24}$/)).min(1).max(500),
      environmentKind: z.enum(["test", "live"]),
      capability: z.string().min(1).max(32).optional(),
      windowSeconds: z.number().int().min(1).max(2_678_400),
      maxRequests: z.number().int().min(1).max(2_000_000_000),
      mode: z.enum(["observe", "enforce"]).default("enforce"),
      actor: onBehalfOf.optional(),
    })
    .strict(),
  policyStatus: z.object({ status: z.enum(["active", "disabled"]), actor: onBehalfOf.optional() }).strict(),
  activateLive: z.object({ approvalRequestId: z.string().min(1).max(100), actor: onBehalfOf.optional() }).strict(),
  environmentStatus: z.object({ status: z.enum(["active", "suspended"]), actor: onBehalfOf.optional() }).strict(),
  setMember: z.object({ role: z.enum(["owner", "admin", "developer", "viewer"]), actor: onBehalfOf.optional() }).strict(),
  createTeam: z.object({ slug, name, actor: onBehalfOf.optional() }).strict(),
  setProjectRole: z
    .object({
      memberEmail: email.optional(),
      teamId: z.string().regex(/^tm_[a-z0-9]{24}$/).optional(),
      role: z.enum(["admin", "developer", "viewer"]),
      actor: onBehalfOf.optional(),
    })
    .strict()
    .refine((value) => Boolean(value.memberEmail) !== Boolean(value.teamId), "exactly one of memberEmail or teamId is required"),
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

const ENV = "organizations/:organizationId/projects/:projectId/environments/:environment";
const APP = `${ENV}/applications/:applicationId`;

@Controller("admin/control-plane")
@UseGuards(ConsoleActorGuard)
export class ControlPlaneAdminController {
  constructor(
    private readonly controlPlane: ControlPlaneAdminService,
    private readonly access: ConsoleAccessService,
    private readonly people: OrganizationPeopleService,
    private readonly quotas: QuotaService,
    private readonly live: LiveEnvironmentService,
    private readonly configuration: CapabilityConfigurationService,
  ) {}

  @Get("capabilities")
  capabilities() {
    return { success: true, data: this.controlPlane.listCapabilities() };
  }

  // ── Organization ─────────────────────────────────────────────────────────

  @Get("organizations/:organizationId/me")
  async me(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    const actor = actorOf(req);
    const access = await this.access.require(actor, org, "organization.read");
    return {
      success: true,
      data: {
        actor: actor.kind === "member" ? { kind: "member", email: actor.email } : { kind: "platform" },
        platformAccess: hasPlatformAccess(actor),
        organizationRole: hasPlatformAccess(actor) ? "owner" : access.organizationRole,
        projectRoles: Object.fromEntries(access.projectRoles),
      },
    };
  }

  @Get("organizations/:organizationId/members")
  async listMembers(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    await this.access.require(actorOf(req), org, "organization.read");
    return { success: true, data: await this.people.listMembers(org) };
  }

  @Put("organizations/:organizationId/members/:email")
  async setMember(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, params.organizationId, "organizationId");
    const memberEmail = parse(schemas.email, params.email, "email");
    const input = parse(schemas.setMember, body, "body");
    const actor = actorOf(req);
    const current = await this.people.memberRole(org, memberEmail);
    const touchesOwner = input.role === "owner" || current === "owner";
    await this.access.require(actor, org, touchesOwner ? "organization.owners.manage" : "organization.members.manage");
    return { success: true, data: await this.people.setMember(org, memberEmail, input.role, actorLabel(actor, input.actor)) };
  }

  @Delete("organizations/:organizationId/members/:email")
  async removeMember(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, params.organizationId, "organizationId");
    const memberEmail = parse(schemas.email, params.email, "email");
    const actor = actorOf(req);
    const current = await this.people.memberRole(org, memberEmail);
    await this.access.require(actor, org, current === "owner" ? "organization.owners.manage" : "organization.members.manage");
    return { success: true, data: await this.people.removeMember(org, memberEmail, actorLabel(actor)) };
  }

  @Get("organizations/:organizationId/teams")
  async listTeams(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    await this.access.require(actorOf(req), org, "organization.read");
    return { success: true, data: await this.people.listTeams(org) };
  }

  @Post("organizations/:organizationId/teams")
  async createTeam(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    const input = parse(schemas.createTeam, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, org, "organization.teams.manage");
    return { success: true, data: await this.people.createTeam(org, input, actorLabel(actor, input.actor)) };
  }

  @Put("organizations/:organizationId/teams/:teamId/members/:email")
  async addTeamMember(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, params.organizationId, "organizationId");
    const actor = actorOf(req);
    await this.access.require(actor, org, "organization.teams.manage");
    const data = await this.people.addTeamMember(org, parse(schemas.resourceId("tm"), params.teamId, "teamId"), parse(schemas.email, params.email, "email"), actorLabel(actor));
    return { success: true, data };
  }

  @Delete("organizations/:organizationId/teams/:teamId/members/:email")
  async removeTeamMember(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, params.organizationId, "organizationId");
    const actor = actorOf(req);
    await this.access.require(actor, org, "organization.teams.manage");
    const data = await this.people.removeTeamMember(org, parse(schemas.resourceId("tm"), params.teamId, "teamId"), parse(schemas.email, params.email, "email"), actorLabel(actor));
    return { success: true, data };
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  @Post("organizations/:organizationId/projects")
  async createProject(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    const input = parse(schemas.createProject, body, "body");
    const actor = actorOf(req);
    const access = await this.access.require(actor, org, "project.create");
    const project = await this.controlPlane.createProject(org, input, actorLabel(actor, input.actor));
    if (actor.kind === "member" && !hasPlatformAccess(actor) && effectiveProjectRole(access, project.id) !== "admin") {
      await this.people.grantCreatorProjectAdmin(org, project.id, actor.email);
    }
    return { success: true, data: project };
  }

  @Get("organizations/:organizationId/projects")
  async listProjects(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    const actor = actorOf(req);
    const access = await this.access.require(actor, org, "organization.read");
    const projects = await this.controlPlane.listProjects(org);
    const visible = hasPlatformAccess(actor) ? projects : projects.filter((project) => effectiveProjectRole(access, project.id));
    return { success: true, data: visible };
  }

  @Get("organizations/:organizationId/projects/:projectId")
  async getProject(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    await this.access.require(actorOf(req), organizationId, "project.read", { projectId });
    return { success: true, data: await this.controlPlane.getProject(organizationId, projectId) };
  }

  @Get("organizations/:organizationId/projects/:projectId/roles")
  async listProjectRoles(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    await this.access.require(actorOf(req), organizationId, "project.read", { projectId });
    return { success: true, data: await this.people.listProjectRoles(organizationId, projectId) };
  }

  @Put("organizations/:organizationId/projects/:projectId/roles")
  async setProjectRole(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    const input = parse(schemas.setProjectRole, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, "project.manage", { projectId });
    const assignee = input.memberEmail ? { memberEmail: input.memberEmail } : { teamId: input.teamId as string };
    return {
      success: true,
      data: await this.people.setProjectRole(organizationId, projectId, assignee, input.role, actorLabel(actor, input.actor)),
    };
  }

  @Delete("organizations/:organizationId/projects/:projectId/roles/:assignmentId")
  async removeProjectRole(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, "project.manage", { projectId });
    const assignmentId = parse(schemas.resourceId("pra"), params.assignmentId, "assignmentId");
    return { success: true, data: await this.people.removeProjectRole(organizationId, projectId, assignmentId, actorLabel(actor)) };
  }

  // ── Plans, quotas and usage ──────────────────────────────────────────────

  @Get("plans")
  plans() {
    return { success: true, data: this.quotas.listPlans() };
  }

  @Get(`${ENV}/plan`)
  async currentPlan(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.quotas.currentPlan(scope) };
  }

  @Put(`${ENV}/plan`)
  async assignPlan(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.assignPlan, body, "body");
    const scope = scopeFrom(params);
    const actor = actorOf(req);
    await this.access.require(actor, scope.organizationId, "project.manage", { projectId: scope.projectId });
    return { success: true, data: await this.quotas.assignPlan(scope, input.planKey, actorLabel(actor, input.actor)) };
  }

  @Get(`${ENV}/usage`)
  async usage(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.quotas.usageSummary(scope, new Date(Date.now() - 24 * 60 * 60 * 1000)) };
  }

  @Get("organizations/:organizationId/projects/:projectId/quota-policies")
  async listProjectQuotas(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    await this.access.require(actorOf(req), organizationId, "project.read", { projectId });
    return { success: true, data: await this.quotas.listPolicies(organizationId, projectId) };
  }

  @Post("organizations/:organizationId/projects/:projectId/quota-policies")
  async createProjectQuota(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    const input = parse(schemas.quotaPolicy, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, "project.manage", { projectId });
    return { success: true, data: await this.quotas.createProjectPolicy(organizationId, projectId, input, actorLabel(actor, input.actor)) };
  }

  @Get("organizations/:organizationId/quota-policies")
  async listQuotas(@Param("organizationId") organizationId: string, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    await this.access.require(actorOf(req), org, "organization.quotas.manage");
    return { success: true, data: await this.quotas.listPolicies(org) };
  }

  @Post("organizations/:organizationId/quota-policies")
  async createSharedQuota(@Param("organizationId") organizationId: string, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, organizationId, "organizationId");
    const { projectIds, ...input } = parse(schemas.sharedQuotaPolicy, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, org, "organization.quotas.manage");
    return { success: true, data: await this.quotas.createSharedPolicy(org, projectIds, input, actorLabel(actor, input.actor)) };
  }

  @Put("organizations/:organizationId/quota-policies/:policyId/status")
  async setQuotaStatus(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const org = parse(schemas.organizationId, params.organizationId, "organizationId");
    const policyId = parse(schemas.resourceId("qp"), params.policyId, "policyId");
    const input = parse(schemas.policyStatus, body, "body");
    const actor = actorOf(req);
    const policy = await this.quotas.policyProject(org, policyId);
    if (policy.scope === "project" && policy.projectId) {
      await this.access.require(actor, org, "project.manage", { projectId: policy.projectId });
    } else {
      await this.access.require(actor, org, "organization.quotas.manage");
    }
    return { success: true, data: await this.quotas.setPolicyStatus(org, policyId, input.status, actorLabel(actor, input.actor)) };
  }

  // ── Live environments and configuration ──────────────────────────────────

  @Post("organizations/:organizationId/projects/:projectId/environments/live")
  async provisionLive(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    const input = parse(schemas.actorOnly, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, "project.manage", { projectId });
    return { success: true, data: await this.live.provision(organizationId, projectId, actorLabel(actor, input.actor)) };
  }

  @Get("organizations/:organizationId/projects/:projectId/environments/live/readiness")
  async liveReadiness(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    await this.access.require(actorOf(req), organizationId, "environment.read", { projectId, environmentKind: "live" });
    return { success: true, data: await this.live.readiness(organizationId, projectId) };
  }

  @Post("organizations/:organizationId/projects/:projectId/environments/live/activate")
  async activateLive(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { organizationId, projectId } = projectScope(params);
    const input = parse(schemas.activateLive, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, organizationId, "project.manage", { projectId });
    return {
      success: true,
      data: await this.live.activate(organizationId, projectId, input.approvalRequestId, actorLabel(actor, input.actor)),
    };
  }

  @Put(`${ENV}/status`)
  async setEnvironmentStatus(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const scope = scopeFrom(params);
    const input = parse(schemas.environmentStatus, body, "body");
    const actor = actorOf(req);
    await this.access.require(actor, scope.organizationId, "project.manage", { projectId: scope.projectId });
    return {
      success: true,
      data: await this.live.setStatus(scope.organizationId, scope.projectId, scope.environmentKind, input.status, actorLabel(actor, input.actor)),
    };
  }

  @Get(`${ENV}/capabilities/:capability/configuration`)
  async readConfiguration(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.configuration.configure(scope, params.capability, "GET", undefined, actorLabel(actor)) };
  }

  @Put(`${ENV}/capabilities/:capability/configuration`)
  async writeConfiguration(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return { success: true, data: await this.configuration.configure(scope, params.capability, "PUT", body, actorLabel(actor)) };
  }

  @Delete(`${ENV}/capabilities/:capability/configuration`)
  async deleteConfiguration(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return { success: true, data: await this.configuration.configure(scope, params.capability, "DELETE", undefined, actorLabel(actor)) };
  }

  // ── Environment resources ────────────────────────────────────────────────

  @Put(`${ENV}/capabilities/:capability`)
  async setCapability(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.setCapability, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return { success: true, data: await this.controlPlane.setCapability(scope, params.capability, input.enabled, actorLabel(actor, input.actor)) };
  }

  @Post(`${ENV}/applications`)
  async createApplication(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.createApplication, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return { success: true, data: await this.controlPlane.createApplication(scope, input, actorLabel(actor, input.actor)) };
  }

  @Get(`${ENV}/applications`)
  async listApplications(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.controlPlane.listApplications(scope) };
  }

  @Post(`${APP}/grants`)
  async grant(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.grant, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return { success: true, data: await this.controlPlane.grant(scope, applicationIdFrom(params), input, actorLabel(actor, input.actor)) };
  }

  @Get(`${APP}/grants`)
  async listGrants(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.controlPlane.listGrants(scope, applicationIdFrom(params)) };
  }

  @Post(`${APP}/grants/:grantId/revoke`)
  async revokeGrant(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.actorOnly, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    const grantId = parse(schemas.resourceId("grt"), params.grantId, "grantId");
    return { success: true, data: await this.controlPlane.revokeGrant(scope, applicationIdFrom(params), grantId, actorLabel(actor, input.actor)) };
  }

  @Post(`${APP}/credentials`)
  async issueCredential(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.issueCredential, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    return {
      success: true,
      data: await this.controlPlane.issueCredential(scope, applicationIdFrom(params), input, actorLabel(actor, input.actor)),
    };
  }

  @Get(`${APP}/credentials`)
  async listCredentials(@Param() params: Record<string, string>, @Req() req: ConsoleRequest) {
    const { scope } = await this.authorizeEnvironment(params, req, "environment.read");
    return { success: true, data: await this.controlPlane.listCredentials(scope, applicationIdFrom(params)) };
  }

  @Post(`${APP}/credentials/:credentialId/revoke`)
  async revokeCredential(@Param() params: Record<string, string>, @Body() body: unknown, @Req() req: ConsoleRequest) {
    const input = parse(schemas.revoke, body, "body");
    const { scope, actor } = await this.authorizeEnvironment(params, req, "environment.write");
    const credentialId = parse(schemas.resourceId("crd"), params.credentialId, "credentialId");
    return {
      success: true,
      data: await this.controlPlane.revokeCredential(scope, applicationIdFrom(params), credentialId, input.reason, actorLabel(actor, input.actor)),
    };
  }

  private async authorizeEnvironment(params: Record<string, string>, req: ConsoleRequest, action: "environment.read" | "environment.write") {
    const scope = scopeFrom(params);
    const actor = actorOf(req);
    await this.access.require(actor, scope.organizationId, action, { projectId: scope.projectId, environmentKind: scope.environmentKind });
    return { scope, actor };
  }
}

function actorOf(req: ConsoleRequest): ConsoleActor {
  if (!req.consoleActor) throw new ValidationError("Console actor is missing");
  return req.consoleActor;
}

function projectScope(params: Record<string, string>) {
  return {
    organizationId: parse(schemas.organizationId, params.organizationId, "organizationId"),
    projectId: parse(schemas.resourceId("prj"), params.projectId, "projectId"),
  };
}

function scopeFrom(params: Record<string, string>): EnvironmentScope {
  return { ...projectScope(params), environmentKind: parse(schemas.environment, params.environment, "environment") };
}

function applicationIdFrom(params: Record<string, string>): string {
  return parse(schemas.resourceId("app"), params.applicationId, "applicationId");
}
