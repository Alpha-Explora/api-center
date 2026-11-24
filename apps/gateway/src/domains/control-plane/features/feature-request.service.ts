import { Injectable, Optional } from "@nestjs/common";
import { Prisma, type CpFeatureRequest } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditEventsService } from "@audit/audit-events.service";
import { PrismaService } from "@database/prisma.service";
import { AppError, NotFoundError, ValidationError } from "@shared/errors";
import { z } from "zod";
import { newResourceId } from "../application-credential";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { withTenant, type TenantDb } from "../tenant-transaction";
import { FEATURE_CATALOG, featureKeySchema, type FeatureKey } from "./feature-catalog";
import { parseChange } from "./feature-gate";
import { FeatureNotifications } from "./feature-notifications";

const DECISION_LEASE_MS = 120_000;
export const featureReason = z.string().trim().min(1).max(500);
const requestStatus = z.enum(["pending", "approved", "rejected", "cancelled"]);
const environmentKind = z.enum(["test", "live"]);

export function featureRequestView(row: CpFeatureRequest) {
  const feature = featureKeySchema.parse(row.feature);
  return {
    id: row.id, organizationId: row.organizationId, projectId: row.projectId,
    environmentKind: environmentKind.parse(row.environmentKind), feature, change: parseChange(feature, row.change),
    reason: row.reason, status: requestStatus.parse(row.status === "deciding" ? "pending" : row.status),
    requestedBy: row.requestedBy, decidedBy: row.decidedBy, decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote, createdAt: row.createdAt.toISOString(),
  };
}

export type FeatureRequest = ReturnType<typeof featureRequestView>;

function decided() {
  return new AppError("This feature request is already being decided or has been closed", 409, "FEATURE_REQUEST_DECIDED");
}

async function environmentId(db: TenantDb, scope: EnvironmentScope) {
  const row = await db.cpEnvironment.findFirst({
    where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
    select: { id: true },
  });
  if (!row) throw new NotFoundError("Project environment was not found");
  return row.id;
}

@Injectable()
export class FeatureRequestService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditEventsService,
    @Optional() private readonly notifications?: FeatureNotifications) {}

  async create(scope: EnvironmentScope, input: { feature: FeatureKey; change: unknown; reason: string }, actor: string) {
    const definition = FEATURE_CATALOG[input.feature];
    if (definition.release[scope.environmentKind] === "coming_soon" || !definition.requestsIn.includes(scope.environmentKind)) {
      throw new AppError("This feature is not available to request in this environment", 409, "FEATURE_NOT_AVAILABLE");
    }
    const change = parseChange(input.feature, input.change);
    const reason = featureReason.safeParse(input.reason);
    if (!reason.success) throw new ValidationError("Reason must be between 1 and 500 characters");
    let request: FeatureRequest;
    try {
      request = await withTenant(this.prisma, scope, async (db) => featureRequestView(await db.cpFeatureRequest.create({
        data: {
          ...scope, environmentId: await environmentId(db, scope), id: newResourceId("frq"),
          feature: input.feature, change: change as Prisma.InputJsonObject, reason: reason.data, requestedBy: actor.toLowerCase(),
        },
      })));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("A request for this feature is already pending", 409, "FEATURE_REQUEST_PENDING");
      }
      throw error;
    }
    const notification = await this.notifications?.requested(request);
    await this.record("requested", request, actor, { notification: notification ?? "not_sent" });
    return request;
  }

  async listForEnvironment(scope: EnvironmentScope) {
    return withTenant(this.prisma, scope, async (db) => {
      const id = await environmentId(db, scope);
      const rows = await db.cpFeatureRequest.findMany({
        where: { ...scope, environmentId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        distinct: ["feature", "status"], take: 50,
      });
      return rows.map(featureRequestView);
    });
  }

  async cancel(scope: EnvironmentScope, id: string, actor: string, mayCancelOthers: boolean) {
    const request = await withTenant(this.prisma, scope, async (db) => {
      const where = { id, ...scope, ...(mayCancelOthers ? {} : { requestedBy: actor.toLowerCase() }) };
      const rows = await db.cpFeatureRequest.updateManyAndReturn({
        where: { ...where, status: "pending" },
        data: { status: "cancelled", decidedBy: actor, decidedAt: new Date() },
      });
      if (rows[0]) return featureRequestView(rows[0]);
      if (!await db.cpFeatureRequest.findFirst({ where, select: { id: true } })) throw new NotFoundError("Feature request was not found");
      throw decided();
    });
    await this.record("cancelled", request, actor);
    return request;
  }

  async claim(id: string, decider: string, allowRecovery: boolean) {
    return withTenant(this.prisma, "platform", async (db) => {
      const row = await db.cpFeatureRequest.findUnique({ where: { id } });
      if (!row) throw new NotFoundError("Feature request was not found");
      if (row.requestedBy === decider.toLowerCase()) {
        throw new AppError("You cannot decide your own feature request", 403, "FEATURE_SELF_APPROVAL");
      }
      const token = randomUUID();
      const now = new Date();
      const [locked] = await db.cpFeatureRequest.updateManyAndReturn({
        where: { id, OR: [
          { status: "pending" },
          ...(allowRecovery ? [{ status: "deciding", claimedAt: { lt: new Date(now.getTime() - DECISION_LEASE_MS) } }] : []),
        ] },
        data: { status: "deciding", claimToken: token, claimedAt: now },
      });
      if (!locked) throw decided();
      return { token, request: featureRequestView(locked) };
    });
  }

  async finish(id: string, token: string, outcome: { status: "approved" | "rejected"; decider: string; note?: string }) {
    return withTenant(this.prisma, "platform", async (db) => {
      const [row] = await db.cpFeatureRequest.updateManyAndReturn({
        where: { id, status: "deciding", claimToken: token },
        data: { status: outcome.status, decidedBy: outcome.decider, decidedAt: new Date(), decisionNote: outcome.note ?? null,
          claimToken: null, claimedAt: null },
      });
      if (!row) throw decided();
      return featureRequestView(row);
    });
  }

  async release(id: string, token: string) {
    await withTenant(this.prisma, "platform", (db) => db.cpFeatureRequest.updateMany({
      where: { id, status: "deciding", claimToken: token },
      data: { status: "pending", claimToken: null, claimedAt: null },
    }));
  }

  async record(action: "requested" | "cancelled" | "approved" | "rejected", request: FeatureRequest, actor: string,
    payload: Record<string, unknown> = {}) {
    const notification = action === "approved" || action === "rejected" ? await this.notifications?.decided(request) : undefined;
    await this.audit.record({
      type: `feature.${action}`, severity: "info", actionFamily: "lifecycle",
      actor, organizationId: request.organizationId, projectId: request.projectId, environment: request.environmentKind,
      resourceType: "feature_request", resourceId: request.id, message: `Feature request ${action}`,
      payload: { feature: request.feature, change: request.change, ...(request.decisionNote ? { note: request.decisionNote } : {}),
        ...(notification ? { notification } : {}), ...payload },
    });
  }
}
