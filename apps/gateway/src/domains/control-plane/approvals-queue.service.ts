// Loads pending live activation requests and API access requests, across all organizations or for
// one. Deciding stays on the existing routes (live-environment.service, published-api.service).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { buildApprovalItems, type ApprovalItem } from "./approvals-queue";
import { withTenant, type TenantScope } from "./tenant-transaction";

@Injectable()
export class ApprovalsQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalRequestService,
  ) {}

  async list(scope: TenantScope): Promise<ApprovalItem[]> {
    const inOrganization = scope === "platform" ? {} : { organizationId: scope.organizationId };
    const loaded = await withTenant(this.prisma, scope, async (db) => {
      const projects = await db.cpProject.findMany({ where: inOrganization, select: { id: true, organizationId: true, name: true } });
      const accessRequests = await db.cpApiAccessRequest.findMany({ where: { ...inOrganization, status: "pending" } });
      const apiIds = [...new Set(accessRequests.map((row) => row.apiId))];
      const applicationIds = [...new Set(accessRequests.map((row) => row.consumerApplicationId))];
      const apis = apiIds.length
        ? await db.cpPublishedApi.findMany({
            where: { ...inOrganization, id: { in: apiIds } },
            select: { id: true, organizationId: true, projectId: true, name: true, environmentKind: true },
          })
        : [];
      const applications = applicationIds.length
        ? await db.cpApplication.findMany({ where: { ...inOrganization, id: { in: applicationIds } }, select: { id: true, name: true } })
        : [];
      const organizationIds = [...new Set(projects.map((row) => row.organizationId))];
      const organizations = organizationIds.length
        ? await db.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })
        : [];
      return { projects, accessRequests, apis, applications, organizations };
    });
    // Activation requests live in the governance schema and carry only the project ID, so they are
    // matched to this scope's projects; requests for projects outside it are dropped.
    const activations = await this.approvals.listPending(
      "environment.activate_live",
      scope === "platform" ? undefined : loaded.projects.map((project) => project.id),
    );
    return buildApprovalItems({ ...loaded, activations });
  }
}
