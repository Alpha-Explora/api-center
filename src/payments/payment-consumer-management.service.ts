import { randomBytes, createHash } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";

const ConsumerInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  eventEndpointUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "eventEndpointUrl must use HTTPS")
    .optional(),
});

type ConsumerInput = z.infer<typeof ConsumerInput>;

@Injectable()
export class PaymentConsumerManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: unknown): Promise<{
    consumerServiceId: string;
    ownerTribeId: string;
    environment: "test" | "live";
    apiKey: string;
  }> {
    const parsed = this.parseInput(input);
    this.requireDatabase();
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
        "UPDATE apic_governance.payment_api_keys SET revoked_at = now() " +
          "WHERE consumer_service_id = $1 AND revoked_at IS NULL",
        service.id,
      );
      await tx.$executeRawUnsafe(
        "INSERT INTO apic_governance.payment_api_keys " +
          "(consumer_service_id, key_prefix, key_hash, scopes) " +
          "VALUES ($1, $2, $3, $4)",
        service.id,
        apiKey.slice(0, 16),
        keyHash,
        ["payments:read", "payments:write"],
      );

      return {
        consumerServiceId: parsed.consumerServiceId,
        ownerTribeId: parsed.ownerTribeId,
        environment: parsed.environment,
        apiKey,
      };
    });
  }

  async rotate(input: unknown): Promise<{
    consumerServiceId: string;
    ownerTribeId: string;
    environment: "test" | "live";
    apiKey: string;
  }> {
    return this.register(input);
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
    try {
      return ConsumerInput.parse(input);
    } catch (error) {
      throw new BadRequestException({
        code: "INVALID_PAYMENT_CONSUMER",
        message: "Invalid payment consumer registration",
        details: error instanceof z.ZodError ? error.issues : undefined,
      });
    }
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

