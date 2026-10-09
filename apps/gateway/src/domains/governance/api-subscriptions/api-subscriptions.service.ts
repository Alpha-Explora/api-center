import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY } from "@registry/tenancy.types";
import type { TenancyDirectory } from "@registry/tenancy.types";
import type { RequestApiSubscriptionDto } from "./api-subscriptions.dto";

@Injectable()
export class ApiSubscriptionsService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.DATABASE_ENABLED !== "true") return;
    const rows = await this.prisma.apiSubscription.findMany({
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      select: {
        consumerProjectId: true,
        apiServiceId: true,
        environment: true,
        status: true,
      },
    });
    this.registry.replaceSubscriptions(rows);
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
        apiServiceId: input.apiServiceId,
        environment: input.environment,
        status: { in: ["pending", "approved"] },
      },
    });
    if (existing) {
      this.registry.setSubscriptionStatus(
        input.consumerProjectId,
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
          apiServiceId: input.apiServiceId,
          environment: input.environment,
          requestedBy: actor,
          reason: input.reason?.trim() || null,
        },
      });
      this.registry.setSubscriptionStatus(
        input.consumerProjectId,
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
            apiServiceId: input.apiServiceId,
            environment: input.environment,
            status: "pending",
          },
        });
        if (pending) {
          this.registry.setSubscriptionStatus(
            input.consumerProjectId,
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

  async list(filters: { consumerProjectId?: string; apiServiceId?: string }) {
    if (!filters.consumerProjectId && !filters.apiServiceId) {
      throw new ValidationError("Specify a consumerProjectId or apiServiceId");
    }
    return this.prisma.apiSubscription.findMany({
      where: {
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
      row.apiServiceId,
      row.environment as "test" | "live",
      status,
    );
    return this.prisma.apiSubscription.findUniqueOrThrow({ where: { id } });
  }
}
