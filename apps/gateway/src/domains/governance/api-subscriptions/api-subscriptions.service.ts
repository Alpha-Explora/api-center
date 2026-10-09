import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY } from "@registry/tenancy.types";
import type { TenancyDirectory } from "@registry/tenancy.types";
import type { RequestApiSubscriptionDto } from "./api-subscriptions.dto";
import { LoggerService } from "@shared/logger.service";

@Injectable()
export class ApiSubscriptionsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshInProgress = false;

  private get subscriptionMaxStalenessMs(): number {
    const configured = Number(process.env.API_SUBSCRIPTION_MAX_STALENESS_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 45_000;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.DATABASE_ENABLED !== "true") return;
    await this.refreshSubscriptionStatuses();
    const configuredInterval = Number(process.env.API_SUBSCRIPTION_REFRESH_MS);
    const intervalMs =
      Number.isFinite(configuredInterval) && configuredInterval > 0
        ? configuredInterval
        : 15_000;
    this.refreshTimer = setInterval(() => {
      void this.refreshSubscriptionStatuses();
    }, intervalMs);
    this.refreshTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshSubscriptionStatuses() {
    if (this.refreshInProgress) return;
    this.refreshInProgress = true;
    try {
      const rows = await this.prisma.apiSubscription.findMany({
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: {
          consumerProjectId: true,
          apiProjectId: true,
          apiServiceId: true,
          environment: true,
          status: true,
        },
      });
      this.registry.replaceSubscriptions(rows, this.subscriptionMaxStalenessMs);
    } catch (error) {
      this.logger.warn(
        `API subscription status refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        "ApiSubscriptionsService",
      );
    } finally {
      this.refreshInProgress = false;
    }
  }

  async request(actor: string, input: RequestApiSubscriptionDto) {
    this.tenancy.requireActiveProject(input.consumerProjectId);
    const target = this.registry.get(input.apiServiceId);
    if (!target || target.serviceType === "shared" || !target.projectId) {
      throw new NotFoundError("A project-owned API service was not found");
    }
    if (target.projectId === input.consumerProjectId) {
      throw new ValidationError("A project cannot subscribe to its own API");
    }
    if (
      !target.environments?.some(
        (environment) => environment.environment === input.environment,
      )
    ) {
      throw new ValidationError(
        "The API does not offer the requested environment",
      );
    }

    const existing = await this.prisma.apiSubscription.findFirst({
      where: {
        consumerProjectId: input.consumerProjectId,
        apiProjectId: target.projectId,
        apiServiceId: input.apiServiceId,
        environment: input.environment,
        status: { in: ["pending", "approved"] },
      },
    });
    if (existing) {
      this.registry.setSubscriptionStatus(
        input.consumerProjectId,
        target.projectId,
        input.apiServiceId,
        input.environment,
        existing.status,
      );
      return existing;
    }

    try {
      const created = await this.prisma.apiSubscription.create({
        data: {
          consumerProjectId: input.consumerProjectId,
          apiProjectId: target.projectId,
          apiServiceId: input.apiServiceId,
          environment: input.environment,
          requestedBy: actor,
          reason: input.reason?.trim() || null,
        },
      });
      this.registry.setSubscriptionStatus(
        input.consumerProjectId,
        target.projectId,
        input.apiServiceId,
        input.environment,
        "pending",
      );
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const pending = await this.prisma.apiSubscription.findFirst({
          where: {
            consumerProjectId: input.consumerProjectId,
            apiProjectId: target.projectId,
            apiServiceId: input.apiServiceId,
            environment: input.environment,
            status: "pending",
          },
        });
        if (pending) {
          this.registry.setSubscriptionStatus(
            input.consumerProjectId,
            target.projectId,
            input.apiServiceId,
            input.environment,
            pending.status,
          );
          return pending;
        }
      }
      throw error;
    }
  }

  async list(filters: {
    consumerProjectId?: string;
    apiProjectId?: string;
    apiServiceId?: string;
  }) {
    if (!filters.consumerProjectId && !filters.apiServiceId) {
      throw new ValidationError("Specify a consumerProjectId or apiServiceId");
    }
    return this.prisma.apiSubscription.findMany({
      where: {
        ...(filters.apiProjectId ? { apiProjectId: filters.apiProjectId } : {}),
        ...(filters.consumerProjectId
          ? { consumerProjectId: filters.consumerProjectId }
          : {}),
        ...(filters.apiServiceId ? { apiServiceId: filters.apiServiceId } : {}),
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.apiSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("API subscription request was not found");
    return row;
  }

  async decide(
    id: string,
    actor: string,
    action: "approve" | "reject" | "revoke",
    reason?: string,
  ) {
    const row = await this.prisma.apiSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("API subscription request was not found");
    const fromStatus = action === "revoke" ? "approved" : "pending";
    if (row.status !== fromStatus) {
      throw new ConflictError(`Cannot ${action} a ${row.status} subscription`);
    }
    const currentApi = this.registry.get(row.apiServiceId);
    if (!currentApi || currentApi.projectId !== row.apiProjectId) {
      throw new ConflictError("API owner changed");
    }
    const status =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "revoked";
    const changed = await this.prisma.apiSubscription.updateMany({
      where: { id, status: fromStatus },
      data: {
        status,
        decidedBy: actor,
        decidedAt: new Date(),
        ...(reason !== undefined ? { reason: reason.trim() || null } : {}),
      },
    });
    if (changed.count !== 1)
      throw new ConflictError("Subscription status changed; refresh and retry");
    this.registry.setSubscriptionStatus(
      row.consumerProjectId,
      row.apiProjectId,
      row.apiServiceId,
      row.environment as "test" | "live",
      status,
    );
    return this.prisma.apiSubscription.findUniqueOrThrow({ where: { id } });
  }
}
