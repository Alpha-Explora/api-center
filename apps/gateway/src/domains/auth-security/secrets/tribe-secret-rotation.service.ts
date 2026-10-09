import { Injectable, Optional } from "@nestjs/common";
import crypto from "node:crypto";
import { AuditEventsService } from "@audit/audit-events.service";
import { requireGovernanceDependency } from "@shared/governance-dependencies";

export type TribeSecretRotationState =
  | "active_current"
  | "active_dual_valid"
  | "old_pending_revoke"
  | "old_revoked";

export type TribeSecretRotationAuditEvent = {
  action: "rotation_started" | "new_secret_verified" | "old_secret_revoked";
  actor: string;
  occurredAt: string;
};

export type TribeSecretRotationPayload = {
  serviceId: string;
  secretHashSha256: string;
  status: "active";
  rotationState: TribeSecretRotationState;
  nextSecretHashSha256?: string;
  previousSecretHashSha256?: string;
  rotatedAt?: string;
  verifiedAt?: string;
  revokedAt?: string;
  auditEvidence: TribeSecretRotationAuditEvent[];
};

type UnknownSecretPayload = {
  serviceId?: unknown;
  secretHashSha256?: unknown;
  nextSecretHashSha256?: unknown;
  previousSecretHashSha256?: unknown;
  status?: unknown;
  rotationState?: unknown;
  rotatedAt?: unknown;
  verifiedAt?: unknown;
  revokedAt?: unknown;
  auditEvidence?: unknown;
};

type RotationActorInput = {
  actor: string;
  now?: Date;
};

type StartRotationInput = RotationActorInput & {
  serviceId: string;
  currentSecretHashSha256: string;
};

export type StartRotationResult = {
  plaintextSecret: string;
  payload: TribeSecretRotationPayload;
};

export type SecretValidationResult = {
  valid: boolean;
  matched: "current" | "next" | null;
  rotationState: TribeSecretRotationState;
};

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_ROTATION_STATE: TribeSecretRotationState = "active_current";

@Injectable()
export class TribeSecretRotationService {
  constructor(@Optional() private readonly auditEvents?: AuditEventsService) {}

  async startRotation(input: StartRotationInput): Promise<StartRotationResult> {
    const now = (input.now ?? new Date()).toISOString();
    const plaintextSecret = this.generatePlaintextSecret();
    const nextSecretHashSha256 = this.hashPlaintextSecret(plaintextSecret);

    const result: StartRotationResult = {
      plaintextSecret,
      payload: {
        serviceId: input.serviceId,
        secretHashSha256: this.normalizeHash(input.currentSecretHashSha256),
        nextSecretHashSha256,
        status: "active",
        rotationState: "active_dual_valid",
        rotatedAt: now,
        auditEvidence: [
          {
            action: "rotation_started",
            actor: input.actor,
            occurredAt: now,
          },
        ],
      },
    };
    await this.recordAudit("rotation_started", input.serviceId, input.actor);
    return result;
  }

  async markNewSecretVerified(
    payload: TribeSecretRotationPayload,
    input: RotationActorInput,
  ): Promise<TribeSecretRotationPayload> {
    if (!payload.nextSecretHashSha256) {
      throw new Error("Cannot verify rotation without nextSecretHashSha256.");
    }

    const now = (input.now ?? new Date()).toISOString();
    const result: TribeSecretRotationPayload = {
      ...payload,
      rotationState: "old_pending_revoke",
      verifiedAt: now,
      auditEvidence: [
        ...payload.auditEvidence,
        {
          action: "new_secret_verified",
          actor: input.actor,
          occurredAt: now,
        },
      ],
    };
    await this.recordAudit(
      "new_secret_verified",
      payload.serviceId,
      input.actor,
    );
    return result;
  }

  async revokeOldSecret(
    payload: TribeSecretRotationPayload,
    input: RotationActorInput,
  ): Promise<TribeSecretRotationPayload> {
    if (!payload.nextSecretHashSha256) {
      throw new Error("Cannot revoke old secret without nextSecretHashSha256.");
    }

    const now = (input.now ?? new Date()).toISOString();
    const { nextSecretHashSha256, ...payloadWithoutNext } = payload;
    const result: TribeSecretRotationPayload = {
      ...payloadWithoutNext,
      secretHashSha256: this.normalizeHash(nextSecretHashSha256),
      previousSecretHashSha256: this.normalizeHash(payload.secretHashSha256),
      rotationState: "old_revoked",
      revokedAt: now,
      auditEvidence: [
        ...payload.auditEvidence,
        {
          action: "old_secret_revoked",
          actor: input.actor,
          occurredAt: now,
        },
      ],
    };
    await this.recordAudit(
      "old_secret_revoked",
      payload.serviceId,
      input.actor,
    );
    return result;
  }

  validatePlaintextSecret(
    payload: UnknownSecretPayload,
    plaintextSecret: string,
  ): SecretValidationResult {
    const requestHash = this.hashPlaintextSecret(plaintextSecret);
    const rotationState = this.resolveRotationState(payload.rotationState);
    const currentHash =
      typeof payload.secretHashSha256 === "string"
        ? this.normalizeHash(payload.secretHashSha256)
        : null;
    const nextHash =
      typeof payload.nextSecretHashSha256 === "string"
        ? this.normalizeHash(payload.nextSecretHashSha256)
        : null;

    if (currentHash && this.secureHashEquals(requestHash, currentHash)) {
      return {
        valid: true,
        matched: "current",
        rotationState,
      };
    }

    if (
      (rotationState === "active_dual_valid" ||
        rotationState === "old_pending_revoke") &&
      nextHash &&
      this.secureHashEquals(requestHash, nextHash)
    ) {
      return {
        valid: true,
        matched: "next",
        rotationState,
      };
    }

    return {
      valid: false,
      matched: null,
      rotationState,
    };
  }

  getAcceptedSecretHashes(payload: UnknownSecretPayload): string[] {
    const rotationState = this.resolveRotationState(payload.rotationState);
    const hashes: string[] = [];

    if (typeof payload.secretHashSha256 === "string") {
      hashes.push(this.normalizeHash(payload.secretHashSha256));
    }

    if (
      (rotationState === "active_dual_valid" ||
        rotationState === "old_pending_revoke") &&
      typeof payload.nextSecretHashSha256 === "string"
    ) {
      hashes.push(this.normalizeHash(payload.nextSecretHashSha256));
    }

    return [...new Set(hashes)].filter((hash) =>
      SHA_256_HEX_PATTERN.test(hash),
    );
  }

  hashPlaintextSecret(plaintextSecret: string): string {
    return crypto.createHash("sha256").update(plaintextSecret).digest("hex");
  }

  private generatePlaintextSecret(): string {
    return `apic_${crypto.randomBytes(32).toString("base64url")}`;
  }

  private normalizeHash(hash: string): string {
    return hash.trim().toLowerCase();
  }

  private resolveRotationState(value: unknown): TribeSecretRotationState {
    return value === "active_dual_valid" ||
      value === "old_pending_revoke" ||
      value === "old_revoked" ||
      value === "active_current"
      ? value
      : DEFAULT_ROTATION_STATE;
  }

  private secureHashEquals(left: string, right: string): boolean {
    if (!SHA_256_HEX_PATTERN.test(left) || !SHA_256_HEX_PATTERN.test(right)) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(left, "utf8"),
      Buffer.from(right, "utf8"),
    );
  }

  private async recordAudit(
    rotationAction: TribeSecretRotationAuditEvent["action"],
    serviceId: string,
    actor: string,
  ): Promise<void> {
    const auditEvents = requireGovernanceDependency(
      this.auditEvents,
      "AuditEventsService",
    );
    await auditEvents.recordRequired({
      type: "secret.reference.rotated",
      actionFamily: "secret",
      actor,
      serviceId,
      resourceType: "secret_reference",
      resourceId: serviceId,
      environment: "control-plane",
      correlationId: `${serviceId}:${rotationAction}`,
      severity: "info",
      message: `secret.reference.rotated for ${serviceId}`,
      payload: { rotationAction },
    });
  }
}
