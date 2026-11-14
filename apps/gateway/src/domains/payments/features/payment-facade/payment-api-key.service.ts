import { createHash, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import type { PaymentAccessDirectory } from "../../shared/payment-access.types";

export type PaymentPrincipal = {
  ownerTribeId: string;
  /** Project of the consumer service, from its registry placement. Payment resources are scoped to it. */
  projectId: string;
  consumerServiceId: string;
  environment: "test" | "live";
  scopes: string[];
  keyId?: string;
};

/** What a key proves before its consumer service is placed in a project. */
type KeyCredential = Omit<PaymentPrincipal, "projectId">;
type ConfiguredKey = KeyCredential & { keyHash: string };
type DatabaseKey = {
  id: string;
  owner_tribe_id: string;
  consumer_service_id: string;
  environment: "test" | "live";
  scopes: string[];
};

@Injectable()
export class PaymentApiKeyService implements PaymentAccessDirectory {
  private readonly usageRecordedAt = new Map<string, number>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
  ) {}

  async resolve(rawKey: string): Promise<PaymentPrincipal | null> {
    if (!/^apic_[A-Za-z0-9_-]+$/.test(rawKey)) return null;

    const presentedHash = createHash("sha256").update(rawKey).digest("hex");
    const credential = process.env.DATABASE_ENABLED === "true"
      ? await this.resolveFromDatabase(presentedHash)
      : this.resolveConfigured(presentedHash);
    if (!credential) return null;

    // The project is never read from the key. It comes from the consumer service's registry placement, and a
    // key whose service is unplaced or belongs to another tribe than the key's owner does not authenticate.
    const placement = this.tenancy.resolveServicePlacement(credential.consumerServiceId);
    const service = this.registry.get(credential.consumerServiceId);
    const projectPlacement = placement
      ? this.tenancy.resolveProject(placement.projectId)
      : null;
    const environment = service?.environments.find(
      (candidate) => candidate.environment === credential.environment,
    );
    if (
      !placement ||
      placement.tribeId !== credential.ownerTribeId ||
      !service ||
      service.status !== "active" ||
      (service.serviceType ?? "tribe") !== "tribe" ||
      service.projectId !== placement.projectId ||
      service.ownerTribeId !== placement.tribeId ||
      !environment ||
      environment.status !== "active" ||
      !projectPlacement ||
      projectPlacement.project.projectId !== placement.projectId ||
      projectPlacement.project.tribeId !== placement.tribeId ||
      projectPlacement.project.status !== "active" ||
      projectPlacement.tribe.tribeId !== placement.tribeId ||
      projectPlacement.tribe.status !== "active"
    ) return null;
    if (credential.keyId && process.env.DATABASE_ENABLED === "true") await this.recordUsage(credential.keyId);
    return { ...credential, projectId: placement.projectId };
  }

  private async recordUsage(keyId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.usageRecordedAt.get(keyId) ?? 0) < 60_000) return;
    if (this.usageRecordedAt.size >= 10_000) this.usageRecordedAt.clear();
    this.usageRecordedAt.set(keyId, now);
    try {
      await this.prisma.$executeRawUnsafe(
        "UPDATE apic_governance.payment_api_keys SET last_used_at=now() WHERE id=$1::uuid AND (last_used_at IS NULL OR last_used_at < now()-interval '1 minute')",
        keyId,
      );
    } catch {
      // Authentication remains available when optional usage telemetry cannot be written.
    }
  }

  async hasActiveReadWriteKey(serviceId: string, projectId: string, environment: "test" | "live"): Promise<boolean | null> {
    const placement = this.tenancy.resolveServicePlacement(serviceId);
    if (!placement || placement.projectId !== projectId) return false;
    if (process.env.DATABASE_ENABLED !== "true") {
      return this.configuredKeys().some((candidate) =>
        candidate.consumerServiceId === serviceId &&
        candidate.ownerTribeId === placement.tribeId &&
        candidate.environment === environment &&
        hasReadWriteAccess(candidate.scopes),
      );
    }
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ scopes: string[] }>>(
        "SELECT k.scopes FROM apic_governance.payment_api_keys k " +
          "JOIN apic_governance.payment_consumer_services s ON s.id = k.consumer_service_id " +
          "WHERE s.consumer_service_id = $1 AND s.owner_tribe_id = $2 AND s.environment = $3 " +
          "AND s.status = 'active' AND k.revoked_at IS NULL " +
          "AND (k.expires_at IS NULL OR k.expires_at > now())",
        serviceId,
        placement.tribeId,
        environment,
      );
      return rows.some((row) => hasReadWriteAccess(Array.isArray(row.scopes) ? row.scopes : []));
    } catch {
      return null;
    }
  }

  private resolveConfigured(keyHash: string): KeyCredential | null {
    for (const candidate of this.configuredKeys()) {
      if (!this.safeEqualHex(keyHash, candidate.keyHash)) continue;
      return {
        ownerTribeId: candidate.ownerTribeId,
        consumerServiceId: candidate.consumerServiceId,
        environment: candidate.environment,
        scopes: candidate.scopes,
        keyId: candidate.keyId,
      };
    }
    return null;
  }

  private async resolveFromDatabase(keyHash: string): Promise<KeyCredential | null> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<DatabaseKey[]>(
        "SELECT k.id, s.owner_tribe_id, s.consumer_service_id, s.environment, k.scopes " +
          "FROM apic_governance.payment_api_keys k " +
          "JOIN apic_governance.payment_consumer_services s ON s.id = k.consumer_service_id " +
          "WHERE k.key_hash = $1 AND k.revoked_at IS NULL " +
          "AND (k.expires_at IS NULL OR k.expires_at > now()) " +
          "AND s.status = 'active' LIMIT 1",
        keyHash,
      );
      const row = rows[0];
      return row
        ? {
            ownerTribeId: row.owner_tribe_id,
            consumerServiceId: row.consumer_service_id,
            environment: row.environment,
            scopes: Array.isArray(row.scopes) ? row.scopes : [],
            keyId: row.id,
          }
        : null;
    } catch {
      return null;
    }
  }

  private configuredKeys(): ConfiguredKey[] {
    const raw = process.env.APICENTER_PAYMENT_API_KEY_CONFIG;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((value): value is ConfiguredKey => this.isConfiguredKey(value));
        }
      } catch {
        return [];
      }
    }

    const fallbackKey = process.env.APICENTER_PAYMENT_API_KEY;
    const fallbackHash = process.env.APICENTER_PAYMENT_API_KEY_HASH;
    const keyHash =
      fallbackHash ||
      (fallbackKey ? createHash("sha256").update(fallbackKey).digest("hex") : undefined);
    if (!keyHash) return [];

    return [
      {
        keyHash,
        ownerTribeId: process.env.APICENTER_PAYMENT_API_KEY_TRIBE_ID || "local",
        consumerServiceId:
          process.env.APICENTER_PAYMENT_API_KEY_SERVICE_ID || "local-service",
        environment:
          process.env.APICENTER_PAYMENT_API_KEY_ENVIRONMENT === "live" ? "live" : "test",
        scopes: (process.env.APICENTER_PAYMENT_API_KEY_SCOPES || "payments:read,payments:write")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
      },
    ];
  }

  private isConfiguredKey(value: unknown): value is ConfiguredKey {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ConfiguredKey>;
    return (
      typeof candidate.keyHash === "string" &&
      typeof candidate.ownerTribeId === "string" &&
      typeof candidate.consumerServiceId === "string" &&
      (candidate.environment === "test" || candidate.environment === "live") &&
      Array.isArray(candidate.scopes) &&
      candidate.scopes.every((scope) => typeof scope === "string")
    );
  }

  private safeEqualHex(left: string, right: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(right)) return false;
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}

function hasReadWriteAccess(scopes: string[]): boolean {
  return canSatisfyScope(scopes, "payments:checkout:read") &&
    canSatisfyScope(scopes, "payments:checkout:write");
}

function canSatisfyScope(scopes: string[], required: string): boolean {
  const direction = required.endsWith(":read") ? "read" : "write";
  return scopes.some((scope) => {
    if (scope === "*" || scope === "payments:*" || scope === required) return true;
    if (scope === `payments:${direction}`) return true;
    return scope.endsWith(":*") && required.startsWith(`${scope.slice(0, -2)}:`);
  });
}
