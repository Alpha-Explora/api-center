import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "@database/prisma.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import type { PaymentConsumerRegistrationDirectory } from "./payment-consumer.types";

/**
 * A payment consumer is a registered tribe service. Its owner tribe comes from the registry
 * (service -> project -> tribe), so callers send only the service; ownerTribeId is rejected.
 */
const ConsumerInput = z.object({
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  approvalRequestId: z.string().uuid().optional(),
  eventEndpointUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "eventEndpointUrl must use HTTPS")
    .optional(),
  scopes: z
    .array(z.enum(["payments:read", "payments:write", "payments:subscriptions:cancel-immediately", "payments:subscriptions:cancel-immediately"]))
    .min(1)
    .max(3)
    .default(["payments:read", "payments:write", "payments:subscriptions:cancel-immediately"]),
}).strict();

type ConsumerInput = z.infer<typeof ConsumerInput> & { ownerTribeId: string; projectId: string };

type KeyRow = {
  key_prefix: string;
  scopes: string[];
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
};

@Injectable()
export class PaymentConsumerManagementService implements PaymentConsumerRegistrationDirectory {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    @Optional() private readonly approvals?: ApprovalRequestService,
  ) {}

  async list(organizationIds?: string[]): Promise<Array<Record<string, unknown>>> {
    this.requireDatabase();
    if (organizationIds && organizationIds.length === 0) return [];
    const tribes = this.tenancy.listTribes?.() ?? [];
    const organizationByTribeId = new Map(
      tribes.map((tribe) => [tribe.tribeId, tribe.organizationId ?? null]),
    );
    const ownerTribeIds = organizationIds
      ? tribes
          .filter((tribe) => tribe.organizationId && organizationIds.includes(tribe.organizationId))
          .map((tribe) => tribe.tribeId)
      : undefined;
    if (ownerTribeIds && ownerTribeIds.length === 0) return [];
    const ownerClause = ownerTribeIds
      ? `AND s.owner_tribe_id IN (${ownerTribeIds.map((_, index) => `$${index + 1}`).join(", ")}) `
      : "";
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      owner_tribe_id: string;
      consumer_service_id: string;
      environment: string;
      status: string;
      event_endpoint_url: string | null;
      created_at: Date;
      updated_at: Date;
      keys: unknown;
    }>>(
      "SELECT s.owner_tribe_id, s.consumer_service_id, s.environment, s.status, " +
        "s.event_endpoint_url, s.created_at, s.updated_at, " +
        "COALESCE(k.keys, '[]'::json) AS keys " +
        "FROM apic_governance.payment_consumer_services s " +
        "LEFT JOIN LATERAL (SELECT json_agg(json_build_object(" +
        "'keyPrefix', key_prefix, 'scopes', scopes, 'expiresAt', expires_at, " +
        "'revokedAt', revoked_at, 'createdAt', created_at)) AS keys " +
        "FROM apic_governance.payment_api_keys WHERE consumer_service_id = s.id) k ON true " +
        "WHERE true " + ownerClause +
        "ORDER BY s.created_at DESC",
      ...(ownerTribeIds ?? []),
    );
    return rows.map((row) => ({
      ownerTribeId: row.owner_tribe_id,
      consumerServiceId: row.consumer_service_id,
      environment: row.environment,
      status: row.status,
      eventEndpointUrl: row.event_endpoint_url,
      organizationId: organizationByTribeId.get(row.owner_tribe_id) ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      keys: row.keys,
    }));
  }

  async register(input: unknown): Promise<{
    consumerServiceId: string;
    ownerTribeId: string;
    environment: "test" | "live";
    apiKey: string;
    keyPrefix: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    status: "active";
  }> {
    return this.registerInternal(input, false);
  }

  async rotate(input: unknown): Promise<Awaited<ReturnType<PaymentConsumerManagementService["register"]>>> {
    return this.registerInternal(input, true);
  }

  private async registerInternal(input: unknown, rotation: boolean): Promise<{
    consumerServiceId: string;
    ownerTribeId: string;
    environment: "test" | "live";
    apiKey: string;
    keyPrefix: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    status: "active";
  }> {
    const parsed = this.parseInput(input);
    this.requireDatabase();
    const registered = (rotation || parsed.environment === "live")
      ? await this.hasRegistration(parsed)
      : false;
    if (rotation && !registered) {
      throw new NotFoundException({
        code: "PAYMENT_CONSUMER_NOT_REGISTERED",
        message: "Register this payment consumer before rotating its key",
      });
    }
    if (parsed.environment === "live" && !registered) {
      if (!this.approvals) {
        throw new ServiceUnavailableException("Live payment registration approval is unavailable");
      }
      await this.approvals.assertApprovedForAction({
        approvalRequestId: parsed.approvalRequestId,
        actionType: "payments.live_access",
        targetEnvironment: "live",
        targetId: parsed.projectId,
        requireTarget: true,
      });
    }
    const apiKey = this.generateKey(parsed.environment);
    const keyHash = this.hash(apiKey);

    return this.prisma.$transaction(async (tx) => {
      const services = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        "INSERT INTO apic_governance.payment_consumer_services " +
          "(owner_tribe_id, consumer_service_id, environment, event_endpoint_url) " +
          "VALUES ($1, $2, $3, $4) " +
          "ON CONFLICT (owner_tribe_id, consumer_service_id, environment) " +
          "DO UPDATE SET event_endpoint_url = COALESCE(EXCLUDED.event_endpoint_url, " +
          "apic_governance.payment_consumer_services.event_endpoint_url), updated_at = now() " +
          "RETURNING id",
        parsed.ownerTribeId,
        parsed.consumerServiceId,
        parsed.environment,
        parsed.eventEndpointUrl ?? null,
      );
      const service = services[0];
      if (!service) throw new Error("Payment consumer registration returned no service");

      await tx.$executeRawUnsafe(
        "UPDATE apic_governance.payment_api_keys SET expires_at = LEAST(COALESCE(expires_at, now() + interval '24 hours'), now() + interval '24 hours') " +
          "WHERE consumer_service_id = $1 AND revoked_at IS NULL",
        service.id,
      );
      const keys = await tx.$queryRawUnsafe<KeyRow[]>(
        "INSERT INTO apic_governance.payment_api_keys " +
          "(consumer_service_id, key_prefix, key_hash, scopes, expires_at) " +
          "VALUES ($1, $2, $3, $4, now() + interval '365 days') " +
          "RETURNING key_prefix, scopes, created_at, expires_at, revoked_at",
        service.id,
        apiKey.slice(0, 16),
        keyHash,
        parsed.scopes,
      );
      const key = keys[0];
      if (!key) throw new Error("Payment consumer key creation returned no key");

      return {
        consumerServiceId: parsed.consumerServiceId,
        ownerTribeId: parsed.ownerTribeId,
        environment: parsed.environment,
        apiKey,
        keyPrefix: key.key_prefix,
        scopes: key.scopes,
        createdAt: key.created_at.toISOString(),
        expiresAt: key.expires_at?.toISOString() ?? null,
        revokedAt: key.revoked_at?.toISOString() ?? null,
        status: "active",
      };
    });
  }

  async revoke(input: unknown): Promise<{ revoked: boolean }> {
    const parsed = this.parseInput(input);
    this.requireDatabase();
    const result = await this.prisma.$executeRawUnsafe(
      "UPDATE apic_governance.payment_api_keys k SET revoked_at = now() " +
        "FROM apic_governance.payment_consumer_services s " +
        "WHERE k.consumer_service_id = s.id " +
        "AND s.owner_tribe_id = $1 AND s.consumer_service_id = $2 " +
        "AND s.environment = $3 AND k.revoked_at IS NULL",
      parsed.ownerTribeId,
      parsed.consumerServiceId,
      parsed.environment,
    );
    return { revoked: result > 0 };
  }

  private parseInput(input: unknown): ConsumerInput {
    let parsed: z.infer<typeof ConsumerInput>;
    try {
      parsed = ConsumerInput.parse(input);
    } catch (error) {
      throw new BadRequestException({
        code: "INVALID_PAYMENT_CONSUMER",
        message: "Invalid payment consumer registration",
        details: error instanceof z.ZodError ? error.issues : undefined,
      });
    }

    const placement = this.tenancy.resolveServicePlacement(parsed.consumerServiceId);
    if (!placement) {
      throw new BadRequestException({
        code: "UNKNOWN_PAYMENT_CONSUMER_SERVICE",
        message: `'${parsed.consumerServiceId}' must be a registered tribe service before it can receive payment keys`,
      });
    }
    return { ...parsed, ownerTribeId: placement.tribeId, projectId: placement.projectId };
  }

  private async hasRegistration(input: ConsumerInput): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM apic_governance.payment_consumer_services " +
        "WHERE owner_tribe_id = $1 AND consumer_service_id = $2 AND environment = $3 LIMIT 1",
      input.ownerTribeId,
      input.consumerServiceId,
      input.environment,
    );
    return rows.length > 0;
  }

  private requireDatabase(): void {
    if (process.env.DATABASE_ENABLED !== "true") {
      throw new ServiceUnavailableException(
        "Payment consumer management requires APICenter DATABASE_ENABLED=true",
      );
    }
  }

  private generateKey(environment: "test" | "live"): string {
    return `apic_${environment}_${randomBytes(24).toString("base64url")}`;
  }

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}
