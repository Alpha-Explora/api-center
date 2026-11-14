// Inventory, backfill, cutover and rollback of legacy tribes, projects and services.
//
// Inventory reads the legacy model through its contexts' public services and plans the migration
// (legacy-plan.ts); its digest is the migration revision. Backfill applies a revision only if the
// source still produces it, and is idempotent through cp_legacy_mappings. Every backfilled project
// environment starts legacy-governed; cutover moves one environment to the control plane under a
// fence version, test before live, and only with no unresolved shadow mismatch. Rollback is refused
// once new-only state exists, so returning never forgets a grant or credential issued since.

import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { TribePlanService } from "@entitlements/tribe-plan.service";
import { PaymentConsumerManagementService } from "@payments/features/consumer-management/payment-consumer-management.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import { newResourceId } from "../application-credential";
import { merchantOrganizationIds } from "../merchant-binding";
import { withTenant, type TenantDb } from "../tenant-transaction";
import type { EnvironmentKind } from "../control-plane.types";
import { planDigest, planMigration, type Kind, type LegacySnapshot, type MigrationPlan } from "./legacy-plan";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function prefixed(prefix: "tm" | "qp" | "ent" | "mig"): string {
  let out = "";
  while (out.length < 24) {
    for (const byte of randomBytes(48)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 24) break;
    }
  }
  return `${prefix}_${out}`;
}

export interface Inventory {
  revision: string;
  plan: MigrationPlan;
  ready: boolean;
}

@Injectable()
export class LegacyMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly registry: RegistryService,
    private readonly quotas: TribeQuotaPolicyService,
    private readonly plans: TribePlanService,
    private readonly paymentConsumers: PaymentConsumerManagementService,
    private readonly audit: AuditEventsService,
  ) {}

  // ── Inventory ────────────────────────────────────────────────────────────

  async snapshot(organizationId: string): Promise<LegacySnapshot> {
    const tribes = (this.tenancy.listTribes?.() ?? []).filter((tribe) => tribe.organizationId === organizationId);
    const tribeIds = tribes.map((tribe) => tribe.tribeId);
    const projects = tribeIds.flatMap((tribeId) => this.tenancy.listProjects?.({ tribeId }) ?? []);
    const entries = Object.values(this.registry.getAll());
    const scopesByService = new Map(
      entries.map((entry) => [
        entry.serviceId,
        [...new Set(this.registry.getCallableServiceIds(entry.serviceId).flatMap((id) => this.registry.get(id)?.requiredScopes ?? []))],
      ]),
    );
    const consumers = tribeIds.length ? await this.paymentConsumers.list([organizationId]) : [];
    const quotaPolicies = tribeIds.length ? await this.quotas.listPolicies({ ownerTribeIds: tribeIds }) : [];
    const planAssignments = (
      await Promise.all(projects.map((project) => this.plans.listPlanAssignments({ ownerTribeId: project.tribeId, projectId: project.projectId, status: "active" })))
    ).flat();

    return {
      organizationId,
      tribes: tribes.map(({ tribeId, name, status }) => ({ tribeId, name, status })),
      projects: projects.map(({ projectId, tribeId, name, status }) => ({ projectId, tribeId, name, status })),
      services: entries.map((entry) => ({
        serviceId: entry.serviceId,
        name: entry.name,
        serviceType: (entry.serviceType ?? "tribe") === "shared" ? "shared" : "tribe",
        projectId: entry.projectId,
        ownerTribeId: entry.ownerTribeId,
        status: entry.status,
        requiredScopes: entry.requiredScopes ?? [],
        exposes: entry.exposes ?? [],
        environments: (entry.environments ?? [])
          .filter((environment) => environment.environment === "test" || environment.environment === "live")
          .map((environment) => ({ environment: environment.environment as Kind, baseUrl: environment.baseUrl, status: environment.status })),
      })),
      canAccess: (source, target, environment) => this.registry.canAccess(source, target, environment),
      tokenScopes: (serviceId) => scopesByService.get(serviceId) ?? [],
      paymentConsumers: consumers.map((consumer) => ({
        ownerTribeId: String(consumer.ownerTribeId),
        consumerServiceId: String(consumer.consumerServiceId),
        environment: consumer.environment as Kind,
        status: String(consumer.status),
        scopes: activeKeyScopes(consumer.keys),
      })),
      planAssignments: planAssignments.map((assignment) => ({
        ownerTribeId: assignment.ownerTribeId,
        projectId: assignment.projectId,
        environment: assignment.environment as Kind,
        planKey: assignment.planKey,
        status: assignment.status,
      })),
      quotaPolicies: quotaPolicies
        .filter((policy) => policy.id)
        .map((policy) => ({
          id: policy.id as string,
          ownerTribeId: policy.ownerTribeId,
          projectId: policy.projectId ?? null,
          scope: policy.scope,
          targetServiceId: policy.targetServiceId ?? null,
          windowSeconds: policy.windowSeconds,
          maxRequests: policy.maxRequests,
          burstRequests: policy.burstRequests ?? null,
          mode: policy.mode,
          status: policy.status,
        })),
      merchantBound: merchantOrganizationIds().includes(organizationId.toLowerCase()),
    };
  }

  /** Plans the migration. Upstreams that fail the SSRF guard are blockers. Has no side effects. */
  async inventory(organizationId: string): Promise<Inventory> {
    const plan = planMigration(await this.snapshot(organizationId));
    for (const project of plan.projects) {
      for (const environment of project.environments) {
        for (const api of environment.apis) {
          try {
            await assertPublicUpstream(api.upstreamUrl, upstreamGuardOptions());
          } catch (error) {
            plan.blockers.push({ legacyId: api.legacyServiceId, reason: `upstream not allowed: ${(error as Error).message}` });
          }
        }
      }
    }
    return { revision: planDigest(plan), plan, ready: plan.blockers.length === 0 };
  }

  // ── Backfill ─────────────────────────────────────────────────────────────

  /** Applies the inventory revision. Re-running it creates nothing new. */
  async backfill(organizationId: string, revision: string, actor: string) {
    const { revision: current, plan } = await this.inventory(organizationId);
    if (current !== revision) {
      throw new AppError("The legacy source changed since this inventory; review the new inventory and its revision", 409, "MIGRATION_SOURCE_CHANGED");
    }
    if (plan.blockers.length) {
      throw new AppError(`Resolve ${plan.blockers.length} blocker(s) before backfill`, 409, "MIGRATION_BLOCKED");
    }
    const counts = await withTenant(this.prisma, { organizationId }, (db) => this.apply(db, plan, revision, actor));
    await this.recordRun(organizationId, "backfill", revision, { counts }, actor);
    return { revision, counts };
  }

  private async apply(db: TenantDb, plan: MigrationPlan, revision: string, actor: string) {
    const counts = { created: 0, reused: 0 };
    const map = async (sourceKind: string, sourceId: string, environmentKind: "" | Kind, targetKind: string, create: () => Promise<string>) => {
      const found = await db.cpLegacyMapping.findUnique({
        where: { sourceKind_sourceId_environmentKind: { sourceKind, sourceId, environmentKind } },
      });
      if (found) {
        counts.reused += 1;
        return found.targetId;
      }
      const targetId = await create();
      await db.cpLegacyMapping.create({
        data: { organizationId: plan.organizationId, sourceKind, sourceId, environmentKind, targetKind, targetId, migrationRevision: revision },
      });
      counts.created += 1;
      return targetId;
    };
    const org = plan.organizationId;

    for (const team of plan.teams) {
      await map("tribe", team.tribeId, "", "team", async () => {
        const id = prefixed("tm");
        await db.cpTeam.create({ data: { id, organizationId: org, slug: team.slug, name: team.name, createdBy: actor } });
        return id;
      });
    }

    const projectIds = new Map<string, string>();
    const applicationIds = new Map<string, string>();
    for (const project of plan.projects) {
      const projectId = await map("project", project.legacyProjectId, "", "project", async () => {
        const id = newResourceId("prj");
        await db.cpProject.create({ data: { id, organizationId: org, slug: project.slug, name: project.name, createdBy: actor } });
        return id;
      });
      projectIds.set(project.legacyProjectId, projectId);

      for (const environment of project.environments) {
        let env = await db.cpEnvironment.findFirst({ where: { organizationId: org, projectId, kind: environment.kind } });
        if (!env) {
          env = await db.cpEnvironment.create({
            data: {
              id: newResourceId("env"),
              organizationId: org,
              projectId,
              kind: environment.kind,
              status: "active",
              // The legacy project already serves this environment; migration preserves it.
              ...(environment.kind === "live"
                ? { activationApprovalId: `migration:${revision.slice(0, 16)}`, activatedAt: new Date(), activatedBy: actor }
                : {}),
            },
          });
        }
        const environmentId = env.id;
        const existingAssignment = await db.cpControlPlaneAssignment.findUnique({
          where: { projectId_environmentKind: { projectId, environmentKind: environment.kind } },
        });
        if (!existingAssignment) {
          await db.cpControlPlaneAssignment.create({
            data: {
              organizationId: org,
              projectId,
              environmentKind: environment.kind,
              authority: "legacy",
              legacyProjectId: project.legacyProjectId,
              legacyTribeId: project.tribeId,
              migrationRevision: revision,
              changedBy: actor,
            },
          });
          await db.cpResourceOwnerMapping.create({
            data: {
              organizationId: org,
              projectId,
              environmentKind: environment.kind,
              ownerGroupId: project.tribeId,
              ownerProjectId: project.legacyProjectId,
              migrationRevision: revision,
            },
          });
        }
        for (const capability of environment.capabilities) {
          await db.cpCapabilityInstallation.upsert({
            where: { environmentId_capability: { environmentId, capability } },
            create: { organizationId: org, projectId, environmentId, capability, createdBy: actor },
            update: {},
          });
        }
        if (environment.planKey && !(await db.cpEntitlement.findFirst({ where: { organizationId: org, environmentId, status: "active" } }))) {
          await db.cpEntitlement.create({
            data: { id: prefixed("ent"), organizationId: org, projectId, environmentId, planKey: environment.planKey, assignedBy: actor },
          });
        }
        for (const api of environment.apis) {
          await map("published_service", api.legacyServiceId, environment.kind, "published_api", async () => {
            const id = newResourceId("api");
            await db.cpPublishedApi.create({
              data: {
                id,
                organizationId: org,
                projectId,
                environmentId,
                environmentKind: environment.kind,
                slug: api.slug,
                name: api.name,
                upstreamUrl: api.upstreamUrl,
                createdBy: actor,
              },
            });
            await db.cpPublishedApiOperation.createMany({
              data: api.operations.map((operation) => ({ organizationId: org, apiId: id, method: operation.method, pathPattern: operation.path, action: operation.action })),
            });
            return id;
          });
        }
        for (const application of environment.applications) {
          const applicationId = await map("service", application.legacyServiceId, environment.kind, "application", async () => {
            const id = newResourceId("app");
            await db.cpApplication.create({
              data: { id, organizationId: org, projectId, environmentId, slug: application.slug, name: application.name, createdBy: actor },
            });
            return id;
          });
          applicationIds.set(`${application.legacyServiceId}@${environment.kind}`, applicationId);
        }
        for (const policy of environment.quotaPolicies) {
          await map("quota_policy", policy.legacyPolicyId, environment.kind, "quota_policy", async () => {
            const id = prefixed("qp");
            await db.cpQuotaPolicy.create({
              data: {
                id,
                organizationId: org,
                scope: "project",
                projectId,
                environmentKind: environment.kind,
                capability: policy.capability,
                windowSeconds: policy.windowSeconds,
                maxRequests: policy.maxRequests,
                mode: policy.mode,
                createdBy: actor,
              },
            });
            return id;
          });
        }
      }
    }

    // Grants last: API targets may live in another project of the organization.
    for (const project of plan.projects) {
      for (const environment of project.environments) {
        for (const application of environment.applications) {
          const applicationId = applicationIds.get(`${application.legacyServiceId}@${environment.kind}`)!;
          const app = await db.cpApplication.findFirst({ where: { id: applicationId, organizationId: org } });
          if (!app) throw new NotFoundError(`Mapped application '${applicationId}' is missing`);
          for (const grant of application.grants) {
            let targetId = grant.target;
            if (grant.targetKind === "api") {
              const mapping = await db.cpLegacyMapping.findUnique({
                where: { sourceKind_sourceId_environmentKind: { sourceKind: "published_service", sourceId: grant.target, environmentKind: environment.kind } },
              });
              if (!mapping) throw new AppError(`API for '${grant.target}' was not backfilled`, 409, "MIGRATION_BLOCKED");
              targetId = mapping.targetId;
            }
            const existing = await db.cpApplicationGrant.findFirst({
              where: { applicationId, targetKind: grant.targetKind, targetId, action: grant.action, status: "active" },
            });
            if (existing) continue;
            await db.cpApplicationGrant.create({
              data: {
                id: newResourceId("grt"),
                organizationId: org,
                projectId: app.projectId,
                environmentId: app.environmentId,
                applicationId,
                targetKind: grant.targetKind,
                targetId,
                action: grant.action,
                provenance: "legacy-snapshot",
                createdBy: actor,
              },
            });
            counts.created += 1;
          }
        }
      }
    }

    for (const ceiling of plan.sharedCeilings) {
      await map("tribe_ceiling", ceiling.legacyPolicyId, ceiling.environmentKind, "quota_policy", async () => {
        const id = prefixed("qp");
        await db.cpQuotaPolicy.create({
          data: {
            id,
            organizationId: org,
            scope: "shared",
            environmentKind: ceiling.environmentKind,
            windowSeconds: ceiling.windowSeconds,
            maxRequests: ceiling.maxRequests,
            mode: ceiling.mode,
            provenance: "legacy-tribe-ceiling",
            createdBy: actor,
          },
        });
        await db.cpQuotaPolicyProject.createMany({
          data: ceiling.legacyProjectIds.map((legacyProjectId) => ({ organizationId: org, policyId: id, projectId: projectIds.get(legacyProjectId)! })),
        });
        return id;
      });
    }
    return counts;
  }

  // ── Assignments, shadow mismatches, cutover and rollback ─────────────────

  async assignments(organizationId: string) {
    return withTenant(this.prisma, { organizationId }, (db) =>
      db.cpControlPlaneAssignment.findMany({ where: { organizationId }, orderBy: [{ legacyProjectId: "asc" }, { environmentKind: "desc" }] }),
    );
  }

  async mismatches(organizationId: string, unresolvedOnly = true) {
    return withTenant(this.prisma, { organizationId }, (db) =>
      db.cpShadowMismatch.findMany({
        where: { organizationId, ...(unresolvedOnly ? { resolvedAt: null } : {}) },
        orderBy: { lastSeenAt: "desc" },
      }),
    );
  }

  /** Marks the mismatches of one project environment resolved, after the grants were corrected. */
  async resolveMismatches(organizationId: string, projectId: string, environmentKind: EnvironmentKind, resolution: string, actor: string) {
    const result = await withTenant(this.prisma, { organizationId }, (db) =>
      db.cpShadowMismatch.updateMany({
        where: { organizationId, projectId, environmentKind, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedBy: actor, resolution },
      }),
    );
    return { resolved: result.count };
  }

  async cutover(organizationId: string, projectId: string, environmentKind: EnvironmentKind, expectedFence: number, actor: string) {
    const assignment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const current = await requireAssignment(db, projectId, environmentKind, expectedFence);
      if (current.authority !== "legacy") throw new ConflictError("This environment is already governed by the control plane");
      if (environmentKind === "live") {
        const test = await db.cpControlPlaneAssignment.findUnique({ where: { projectId_environmentKind: { projectId, environmentKind: "test" } } });
        if (test && test.authority !== "new") throw new AppError("Cut over the test environment before live", 409, "TEST_BEFORE_LIVE");
      }
      const unresolved = await db.cpShadowMismatch.count({ where: { organizationId, projectId, environmentKind, resolvedAt: null } });
      if (unresolved > 0) {
        throw new AppError(`${unresolved} unresolved shadow mismatch(es); correct the grants and resolve them first`, 409, "SHADOW_MISMATCHES");
      }
      const now = new Date();
      return db.cpControlPlaneAssignment.update({
        where: { projectId_environmentKind: { projectId, environmentKind } },
        data: { authority: "new", fenceVersion: { increment: 1 }, changedBy: actor, changedAt: now, cutOverAt: now },
      });
    });
    await this.recordRun(organizationId, "cutover", assignment.migrationRevision, { projectId, environmentKind, fence: assignment.fenceVersion }, actor, projectId, environmentKind);
    return assignment;
  }

  /**
   * Returns an environment to the legacy model. Refused when anything was created in the control
   * plane since cutover (grants, applications, credentials, APIs): the legacy model cannot
   * represent it, so the fix is a forward repair.
   */
  async rollback(organizationId: string, projectId: string, environmentKind: EnvironmentKind, expectedFence: number, actor: string) {
    const assignment = await withTenant(this.prisma, { organizationId }, async (db) => {
      const current = await requireAssignment(db, projectId, environmentKind, expectedFence);
      if (current.authority !== "new" || !current.cutOverAt) throw new ConflictError("This environment is not cut over");
      const environment = await db.cpEnvironment.findFirst({ where: { organizationId, projectId, kind: environmentKind } });
      const since = { gt: current.cutOverAt };
      const where = { organizationId, environmentId: environment?.id ?? "", createdAt: since };
      const created = {
        grants: await db.cpApplicationGrant.count({ where: { ...where, provenance: "explicit" } }),
        applications: await db.cpApplication.count({ where }),
        credentials: await db.cpCredential.count({ where }),
        apis: await db.cpPublishedApi.count({ where }),
      };
      if (Object.values(created).some((count) => count > 0)) {
        throw new AppError(
          `Rollback would forget control-plane state created since cutover (${JSON.stringify(created)}); repair forward instead`,
          409,
          "ROLLBACK_BLOCKED",
        );
      }
      return db.cpControlPlaneAssignment.update({
        where: { projectId_environmentKind: { projectId, environmentKind } },
        data: { authority: "legacy", fenceVersion: { increment: 1 }, changedBy: actor, changedAt: new Date(), cutOverAt: null },
      });
    });
    await this.recordRun(organizationId, "rollback", assignment.migrationRevision, { projectId, environmentKind, fence: assignment.fenceVersion }, actor, projectId, environmentKind);
    return assignment;
  }

  private async recordRun(
    organizationId: string,
    kind: "backfill" | "cutover" | "rollback",
    revision: string,
    report: Record<string, unknown>,
    actor: string,
    projectId?: string,
    environmentKind?: string,
  ) {
    await withTenant(this.prisma, { organizationId }, (db) =>
      db.cpMigrationRun.create({
        data: {
          id: prefixed("mig"),
          organizationId,
          kind,
          migrationRevision: revision,
          report: report as object,
          actor,
          ...(projectId ? { projectId } : {}),
          ...(environmentKind ? { environmentKind } : {}),
        },
      }),
    );
    await this.audit.record({
      type: `control_plane.migration.${kind}`,
      actionFamily: "lifecycle",
      actor,
      resourceType: "cp_migration",
      resourceId: projectId ? `${projectId}:${environmentKind}` : organizationId,
      ...(environmentKind ? { environment: environmentKind } : {}),
      severity: "info",
      message: `Control plane migration ${kind}`,
      payload: { revision, ...report },
    });
  }
}

async function requireAssignment(db: TenantDb, projectId: string, environmentKind: EnvironmentKind, expectedFence: number) {
  const current = await db.cpControlPlaneAssignment.findUnique({ where: { projectId_environmentKind: { projectId, environmentKind } } });
  if (!current) throw new NotFoundError("This project environment was not migrated");
  if (current.fenceVersion !== expectedFence) {
    throw new AppError(`Fence is ${current.fenceVersion}, not ${expectedFence}; reload and retry`, 409, "FENCE_MISMATCH");
  }
  return current;
}

function activeKeyScopes(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const now = Date.now();
  return [
    ...new Set(
      keys
        .filter((key) => key && typeof key === "object")
        .map((key) => key as { scopes?: unknown; revokedAt?: unknown; expiresAt?: unknown })
        .filter((key) => !key.revokedAt && (!key.expiresAt || new Date(String(key.expiresAt)).getTime() > now))
        .flatMap((key) => (Array.isArray(key.scopes) ? key.scopes.map(String) : [])),
    ),
  ];
}
