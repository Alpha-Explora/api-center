// Connects legacy callers (service JWTs) to the control plane during migration.
//
// For a caller whose legacy project environment was backfilled:
// - legacy authority: the legacy decision stands; the control-plane decision for the mapped
//   application is computed afterwards and any difference is recorded as a shadow mismatch.
// - control-plane authority (after cutover): the mapped application's explicit grants decide, and
//   the call is counted and signed like any application call. The legacy token stays valid as the
//   credential, so consumers keep working unchanged through cutover.
// Callers whose project was never migrated are untouched.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { AppError } from "@shared/errors";
import { ApplicationAccessService, type RequestTarget } from "../application-access.service";
import { withTenant } from "../tenant-transaction";
import type { EnvironmentKind } from "../control-plane.types";

interface MigratedRoute {
  organizationId: string;
  projectId: string;
  environmentKind: EnvironmentKind;
  sourceServiceId: string;
  applicationId: string | undefined;
}

export type LegacyRoute = { mode: "legacy" } | (MigratedRoute & { mode: "shadow" }) | (MigratedRoute & { mode: "control-plane" });

/** A legacy target: a shared capability or another legacy service (its published API). */
export type LegacyTarget =
  | { kind: "capability"; capability: string; method: string; relativePath: string }
  | { kind: "service"; legacyServiceId: string; method: string; relativePath: string };

@Injectable()
export class LegacyBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly access: ApplicationAccessService,
  ) {}

  async route(caller: { sourceServiceId?: string; projectId?: string; environment?: string }): Promise<LegacyRoute> {
    const { sourceServiceId, projectId } = caller;
    const environmentKind = caller.environment;
    if (!sourceServiceId || !projectId || (environmentKind !== "test" && environmentKind !== "live")) return { mode: "legacy" };
    const organizationId = this.tenancy.resolveProject(projectId)?.tribe.organizationId;
    if (!organizationId || (!process.env.DATABASE_URL && process.env.DATABASE_ENABLED !== "true")) return { mode: "legacy" };

    return withTenant(this.prisma, { organizationId }, async (db) => {
      const assignment = await db.cpControlPlaneAssignment.findFirst({ where: { organizationId, legacyProjectId: projectId, environmentKind } });
      if (!assignment) return { mode: "legacy" } as const;
      const mapping = await db.cpLegacyMapping.findUnique({
        where: { sourceKind_sourceId_environmentKind: { sourceKind: "service", sourceId: sourceServiceId, environmentKind } },
      });
      return {
        mode: assignment.authority === "new" ? "control-plane" : "shadow",
        organizationId,
        projectId: assignment.projectId,
        environmentKind,
        sourceServiceId,
        applicationId: mapping?.targetId,
      } as LegacyRoute;
    });
  }

  /** The control-plane request target for a legacy target; undefined when it was not migrated. */
  async target(organizationId: string, environmentKind: EnvironmentKind, legacy: LegacyTarget): Promise<RequestTarget | undefined> {
    if (legacy.kind === "capability") return legacy;
    const mapping = await withTenant(this.prisma, { organizationId }, (db) =>
      db.cpLegacyMapping.findUnique({
        where: { sourceKind_sourceId_environmentKind: { sourceKind: "published_service", sourceId: legacy.legacyServiceId, environmentKind } },
      }),
    );
    return mapping ? { kind: "api", apiId: mapping.targetId, method: legacy.method, relativePath: legacy.relativePath } : undefined;
  }

  /** Authorizes a cut-over legacy caller through its mapped application. Fails closed. */
  async authorize(route: Extract<LegacyRoute, { mode: "control-plane" }>, legacy: LegacyTarget, request: { requestId: string; idempotencyKey?: string }) {
    if (!route.applicationId) {
      throw new AppError("This service was not migrated with its project; it has no control-plane identity", 403, "LEGACY_SERVICE_UNMAPPED");
    }
    const target = await this.target(route.organizationId, route.environmentKind, legacy);
    if (!target) throw new AppError("The target was not migrated to the control plane", 403, "API_NOT_AVAILABLE");
    return this.access.authorizeMapped({ organizationId: route.organizationId, applicationId: route.applicationId }, target, request);
  }

  /** Records how an admitted request ended, for usage reporting. */
  async recordOutcome(call: Parameters<ApplicationAccessService["recordOutcome"]>[0], statusCode: number): Promise<void> {
    await this.access.recordOutcome(call, statusCode);
  }

  /**
   * Records the legacy decision against the control-plane decision for the same call. Never
   * throws: shadowing must not affect the legacy request.
   */
  async shadow(route: LegacyRoute, legacy: LegacyTarget, legacyAllowed: boolean): Promise<void> {
    if (route.mode !== "shadow") return;
    try {
      const target = await this.target(route.organizationId, route.environmentKind, legacy);
      const evaluation =
        route.applicationId && target
          ? await this.access.evaluateMapped({ organizationId: route.organizationId, applicationId: route.applicationId }, target)
          : { allowed: false, action: undefined };
      if (evaluation.allowed === legacyAllowed) return;
      const targetLabel = legacy.kind === "capability" ? `capability:${legacy.capability}` : `service:${legacy.legacyServiceId}`;
      const action = evaluation.action ?? `${legacy.method.toUpperCase()} ${legacy.relativePath}`.slice(0, 200);
      await withTenant(this.prisma, { organizationId: route.organizationId }, async (db) => {
        const key = {
          projectId: route.projectId,
          environmentKind: route.environmentKind,
          sourceServiceId: route.sourceServiceId,
          target: targetLabel,
          action,
          legacyAllowed,
        };
        await db.cpShadowMismatch.upsert({
          where: { projectId_environmentKind_sourceServiceId_target_action_legacyAllowed: key },
          create: { organizationId: route.organizationId, ...key, newAllowed: evaluation.allowed },
          update: { occurrences: { increment: 1 }, lastSeenAt: new Date(), resolvedAt: null, resolvedBy: null, resolution: null },
        });
      });
    } catch {
      // Shadow evidence is best effort; the legacy request already completed.
    }
  }
}
