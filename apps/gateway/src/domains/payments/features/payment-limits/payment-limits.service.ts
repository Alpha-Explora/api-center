import {
  Injectable,
  HttpException,
  HttpStatus,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { PLAN_DEFINITIONS } from "@entitlements/tribe-plan-definitions";

export type PaymentEnvironment = "test" | "live";

export interface EffectivePaymentLimits {
  projectId: string;
  environment: PaymentEnvironment;
  planKey: string;
  maximumPaymentAmountMinor: number | null;
  paymentRequestsPerMinute: number | null;
  overridden: boolean;
  reason?: string;
}

interface PaymentLimitPrisma {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

@Injectable()
export class PaymentLimitsService {
  private readonly limitPrisma: PaymentLimitPrisma;
  private readonly localWindows = new Map<string, { minute: number; count: number }>();

  constructor(prisma: PrismaService) {
    this.limitPrisma = prisma as unknown as PaymentLimitPrisma;
  }

  async resolve(
    ownerTribeId: string,
    projectId: string,
    environment: PaymentEnvironment,
  ): Promise<EffectivePaymentLimits> {
    let planKey = "starter";
    let override: {
      maximum_payment_amount_minor: string | number | bigint;
      payment_requests_per_minute: number;
      reason: string;
    } | undefined;

    if (process.env.DATABASE_ENABLED === "true") {
      const assignments = await this.limitPrisma.$queryRawUnsafe<Array<{ plan_key: string }>>(
        "SELECT plan_key FROM apic_governance.entitlement_assignments " +
          "WHERE owner_tribe_id = $1 AND project_id = $2 AND environment = $3 " +
          "AND status = 'active' ORDER BY effective_at DESC, updated_at DESC LIMIT 1",
        ownerTribeId,
        projectId,
        environment,
      );
      if (assignments[0]) planKey = assignments[0].plan_key;
      const overrides = await this.limitPrisma.$queryRawUnsafe<typeof override[]>(
        "SELECT maximum_payment_amount_minor, payment_requests_per_minute, reason " +
          "FROM apic_governance.payment_limit_overrides " +
          "WHERE project_id = $1 AND environment = $2 LIMIT 1",
        projectId,
        environment,
      );
      override = overrides[0];
    }

    const plan = PLAN_DEFINITIONS.find((definition) => definition.planKey === planKey)
      ?? PLAN_DEFINITIONS[0];
    return {
      projectId,
      environment,
      planKey: plan.planKey,
      maximumPaymentAmountMinor: override
        ? Number(override.maximum_payment_amount_minor)
        : plan.paymentAmountMinor,
      paymentRequestsPerMinute: override?.payment_requests_per_minute
        ?? plan.paymentRequestsPerMinute,
      overridden: Boolean(override),
      ...(override ? { reason: override.reason } : {}),
    };
  }

  async enforce(input: {
    ownerTribeId: string;
    projectId: string;
    environment: PaymentEnvironment;
    amountMinor?: number;
  }): Promise<EffectivePaymentLimits> {
    const limits = await this.resolve(input.ownerTribeId, input.projectId, input.environment);
    if (
      input.amountMinor !== undefined &&
      limits.maximumPaymentAmountMinor !== null &&
      input.amountMinor > limits.maximumPaymentAmountMinor
    ) {
      throw new UnprocessableEntityException({
        code: "AMOUNT_LIMIT_EXCEEDED",
        message: `Payment amount exceeds the project limit of ${limits.maximumPaymentAmountMinor} minor units`,
      });
    }

    if (limits.paymentRequestsPerMinute !== null) {
      const count = process.env.DATABASE_ENABLED === "true"
        ? await this.incrementDatabaseWindow(input.projectId, input.environment)
        : this.incrementLocalWindow(input.projectId, input.environment);
      if (count > limits.paymentRequestsPerMinute) {
        throw new HttpException({
          code: "PAYMENT_RATE_LIMIT_EXCEEDED",
          message: "Payment request rate exceeds the project's per-minute limit",
        }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return limits;
  }

  async setOverride(input: {
    ownerTribeId: string;
    projectId: string;
    environment: PaymentEnvironment;
    maximumPaymentAmountMinor: number;
    paymentRequestsPerMinute: number;
    reason: string;
    updatedBy: string;
  }): Promise<void> {
    await this.limitPrisma.$executeRawUnsafe(
      "INSERT INTO apic_governance.payment_limit_overrides " +
        "(owner_tribe_id, project_id, environment, maximum_payment_amount_minor, " +
        "payment_requests_per_minute, reason, updated_by) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
        "ON CONFLICT (project_id, environment) DO UPDATE SET " +
        "owner_tribe_id = EXCLUDED.owner_tribe_id, " +
        "maximum_payment_amount_minor = EXCLUDED.maximum_payment_amount_minor, " +
        "payment_requests_per_minute = EXCLUDED.payment_requests_per_minute, " +
        "reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()",
      input.ownerTribeId,
      input.projectId,
      input.environment,
      input.maximumPaymentAmountMinor,
      input.paymentRequestsPerMinute,
      input.reason,
      input.updatedBy,
    );
  }

  async clearOverride(projectId: string, environment: PaymentEnvironment): Promise<boolean> {
    const deleted = await this.limitPrisma.$executeRawUnsafe(
      "DELETE FROM apic_governance.payment_limit_overrides WHERE project_id = $1 AND environment = $2",
      projectId,
      environment,
    );
    return deleted > 0;
  }

  private async incrementDatabaseWindow(
    projectId: string,
    environment: PaymentEnvironment,
  ): Promise<number> {
    const rows = await this.limitPrisma.$queryRawUnsafe<Array<{ request_count: number }>>(
      "INSERT INTO apic_governance.payment_request_rate_windows " +
        "(project_id, environment, window_started_at, request_count) " +
        "VALUES ($1, $2, date_trunc('minute', now()), 1) " +
        "ON CONFLICT (project_id, environment) DO UPDATE SET " +
        "request_count = CASE " +
        "WHEN apic_governance.payment_request_rate_windows.window_started_at = date_trunc('minute', now()) " +
        "THEN apic_governance.payment_request_rate_windows.request_count + 1 ELSE 1 END, " +
        "window_started_at = date_trunc('minute', now()) RETURNING request_count",
      projectId,
      environment,
    );
    return Number(rows[0]?.request_count ?? 0);
  }

  private incrementLocalWindow(projectId: string, environment: PaymentEnvironment): number {
    const key = `${projectId}:${environment}`;
    const minute = Math.floor(Date.now() / 60_000);
    const current = this.localWindows.get(key);
    const next = current?.minute === minute
      ? { minute, count: current.count + 1 }
      : { minute, count: 1 };
    this.localWindows.set(key, next);
    if (this.localWindows.size > 10_000) {
      for (const [candidate, value] of this.localWindows) {
        if (value.minute < minute) this.localWindows.delete(candidate);
      }
    }
    return next.count;
  }
}
