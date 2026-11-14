import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { PrismaService } from "@database/prisma.service";
import { ServiceSecretResolverService } from "./service-secret-resolver.service";
import { RegistryService } from "./registry.service";
import { buildEnvironmentSecretId } from "./environment-secret-name";
import { z } from "zod";

export const SERVICE_CREDENTIAL_MANAGER = Symbol("SERVICE_CREDENTIAL_MANAGER");
type Manager = Pick<
  SecretManagerServiceClient,
  "accessSecretVersion" | "addSecretVersion"
>;
export const credentialAction = z
  .object({
    serviceId: z.string().regex(/^[a-z0-9-]{1,64}$/),
    environment: z.enum(["test", "live"]),
    operationId: z.string().uuid(),
    action: z.enum(["start", "verify", "revoke-old"]),
    secretHashSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    actor: z.string().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const payloadSchema = z
  .object({
    serviceId: z.string(),
    environment: z.enum(["test", "live"]),
    status: z.literal("active"),
    secretHashSha256: z.string().regex(/^[a-f0-9]{64}$/),
    nextSecretHashSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    rotationState: z
      .enum([
        "active_current",
        "active_dual_valid",
        "old_pending_revoke",
        "old_revoked",
      ])
      .default("active_current"),
    verifiedAt: z.string().datetime().optional(),
    auditEvidence: z.array(z.unknown()).default([]),
  })
  .passthrough();

@Injectable()
export class ServiceCredentialLifecycleService {
  private readonly manager: Manager;
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    private readonly resolver: ServiceSecretResolverService,
    @Optional() @Inject(SERVICE_CREDENTIAL_MANAGER) manager?: Manager,
  ) {
    this.manager = manager ?? new SecretManagerServiceClient();
  }

  async apply(input: unknown) {
    const parsed = credentialAction.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid credential lifecycle action");
    const action = parsed.data;
    const entry = this.registry.get(action.serviceId);
    if (
      !entry?.projectId ||
      !entry.environments.some((row) => row.environment === action.environment)
    )
      throw new BadRequestException("Registered service environment required");
    const project =
      process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;
    if (!project || process.env.DATABASE_ENABLED !== "true")
      throw new ServiceUnavailableException(
        "Credential lifecycle requires configured Secret Manager and database",
      );
    const claims = await this.prisma.$queryRawUnsafe<
      Array<{ operation_id: string }>
    >(
      "INSERT INTO apic_catalog.service_credential_operations(operation_id,service_id,environment,action,actor,reason,status) VALUES ($1::uuid,$2,$3,$4,$5,$6,'running') ON CONFLICT DO NOTHING RETURNING operation_id",
      action.operationId,
      action.serviceId,
      action.environment,
      action.action,
      action.actor,
      action.reason,
    );
    if (!claims.length)
      throw new ConflictException({
        code: "CREDENTIAL_OPERATION_EXISTS",
        message:
          "An operation already exists for this request or rotation is awaiting reconciliation. Inspect the current state before another action.",
      });
    let writeStarted = false;
    try {
      const parent = `projects/${project}/secrets/${buildEnvironmentSecretId(action.serviceId, action.environment)}`;
      const [version] = await this.manager.accessSecretVersion({
        name: parent + "/versions/latest",
      });
      const raw = version.payload?.data;
      if (!raw)
        throw new BadRequestException("Active credential payload unavailable");
      const payload = payloadSchema.parse(
        JSON.parse(Buffer.from(raw).toString("utf8")),
      );
      if (
        payload.serviceId !== action.serviceId ||
        payload.environment !== action.environment
      )
        throw new BadRequestException("Credential identity mismatch");
      const timestamp = new Date().toISOString();
      let next: z.infer<typeof payloadSchema>;
      if (action.action === "start") {
        if (
          !action.secretHashSha256 ||
          action.secretHashSha256 === payload.secretHashSha256 ||
          payload.nextSecretHashSha256
        )
          throw new BadRequestException(
            "Generate a different replacement and complete any existing rotation first",
          );
        next = {
          ...payload,
          nextSecretHashSha256: action.secretHashSha256,
          rotationState: "active_dual_valid",
          rotatedAt: timestamp,
        };
        delete next.verifiedAt;
      } else if (action.action === "verify") {
        if (
          payload.rotationState !== "active_dual_valid" ||
          !payload.nextSecretHashSha256
        )
          throw new BadRequestException("Start rotation before verification");
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{ last_used_at: Date }>
        >(
          "SELECT last_used_at FROM apic_catalog.service_credential_usage WHERE service_id=$1 AND environment=$2 AND version_name=$3 AND role='next'",
          action.serviceId,
          action.environment,
          version.name,
        );
        if (!rows[0])
          throw new BadRequestException(
            "Authenticate with the replacement credential before marking it verified",
          );
        next = {
          ...payload,
          rotationState: "old_pending_revoke",
          verifiedAt: rows[0].last_used_at.toISOString(),
        };
      } else {
        if (
          payload.rotationState !== "old_pending_revoke" ||
          !payload.nextSecretHashSha256 ||
          !payload.verifiedAt
        )
          throw new BadRequestException(
            "Verify replacement authentication before revoking the old secret",
          );
        const { nextSecretHashSha256, ...rest } = payload;
        next = {
          ...rest,
          secretHashSha256: nextSecretHashSha256,
          rotationState: "old_revoked",
          revokedAt: timestamp,
        };
      }
      next.auditEvidence = [
        ...payload.auditEvidence.slice(-19),
        {
          action: action.action,
          actor: action.actor,
          reason: action.reason,
          occurredAt: timestamp,
        },
      ];
      writeStarted = true;
      const [created] = await this.manager.addSecretVersion({
        parent,
        payload: { data: Buffer.from(JSON.stringify(next)) },
      });
      if (!created.name)
        throw new Error("Credential version response unavailable");
      await this.prisma.$executeRawUnsafe(
        "UPDATE apic_catalog.service_credential_operations SET status='completed',version_name=$2,updated_at=now() WHERE operation_id=$1::uuid",
        action.operationId,
        created.name,
      );
      this.resolver.clearCache(action.serviceId);
      return {
        serviceId: action.serviceId,
        environment: action.environment,
        versionName: created.name,
        rotationState: next.rotationState,
      };
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        "UPDATE apic_catalog.service_credential_operations SET status=$2,updated_at=now() WHERE operation_id=$1::uuid",
        action.operationId,
        writeStarted ? "uncertain" : "failed",
      );
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        writeStarted
          ? "Credential update outcome is uncertain. Reconcile the Secret Manager version before another operation."
          : "Credential lifecycle could not read the active credential",
      );
    }
  }
}
