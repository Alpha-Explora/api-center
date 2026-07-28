import { AuditEventsService } from "../../../../apps/gateway/src/analytics/audit-events.service";
import { TribeSecretRotationService } from "../../../../apps/gateway/src/secrets/tribe-secret-rotation.service";

describe("TribeSecretRotationService", () => {
  let auditEvents: { recordRequired: jest.Mock };
  let service: TribeSecretRotationService;

  beforeEach(() => {
    auditEvents = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    service = new TribeSecretRotationService(
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("starts rotation with active_dual_valid state and one-time plaintext secret", async () => {
    const currentHash = service.hashPlaintextSecret("old-secret");
    const result = await service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: currentHash,
      actor: "platform-admin@example.test",
      now: new Date("2026-05-25T01:00:00.000Z"),
    });

    expect(result.plaintextSecret).toMatch(/^apic_/);
    expect(result.payload).toEqual(
      expect.objectContaining({
        serviceId: "logistics",
        secretHashSha256: currentHash,
        nextSecretHashSha256: service.hashPlaintextSecret(
          result.plaintextSecret,
        ),
        rotationState: "active_dual_valid",
        rotatedAt: "2026-05-25T01:00:00.000Z",
      }),
    );
    expect(result.payload.auditEvidence).toEqual([
      {
        action: "rotation_started",
        actor: "platform-admin@example.test",
        occurredAt: "2026-05-25T01:00:00.000Z",
      },
    ]);
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "secret.reference.rotated",
      actionFamily: "secret",
      actor: "platform-admin@example.test",
      serviceId: "logistics",
      resourceType: "secret_reference",
      resourceId: "logistics",
      environment: "control-plane",
      correlationId: "logistics:rotation_started",
      severity: "info",
      message: "secret.reference.rotated for logistics",
      payload: { rotationAction: "rotation_started" },
    });
  });

  it("fails closed when secret rotation audit evidence cannot be written", async () => {
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      service.startRotation({
        serviceId: "logistics",
        currentSecretHashSha256: service.hashPlaintextSecret("old-secret"),
        actor: "operator",
      }),
    ).rejects.toThrow("audit unavailable");
  });

  it("validates current and next secrets during the dual-valid window", async () => {
    const currentHash = service.hashPlaintextSecret("old-secret");
    const { plaintextSecret, payload } = await service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: currentHash,
      actor: "operator",
    });

    expect(service.validatePlaintextSecret(payload, "old-secret")).toEqual({
      valid: true,
      matched: "current",
      rotationState: "active_dual_valid",
    });
    expect(service.validatePlaintextSecret(payload, plaintextSecret)).toEqual({
      valid: true,
      matched: "next",
      rotationState: "active_dual_valid",
    });
  });

  it("moves to old_pending_revoke after the tribe verifies the new secret", async () => {
    const { payload } = await service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: service.hashPlaintextSecret("old-secret"),
      actor: "operator",
      now: new Date("2026-05-25T01:00:00.000Z"),
    });

    const verified = await service.markNewSecretVerified(payload, {
      actor: "tribe-owner@example.test",
      now: new Date("2026-05-25T02:00:00.000Z"),
    });

    expect(verified.rotationState).toBe("old_pending_revoke");
    expect(verified.verifiedAt).toBe("2026-05-25T02:00:00.000Z");
    expect(verified.auditEvidence.at(-1)).toEqual({
      action: "new_secret_verified",
      actor: "tribe-owner@example.test",
      occurredAt: "2026-05-25T02:00:00.000Z",
    });
  });

  it("revokes the old secret and only accepts the replacement secret", async () => {
    const { plaintextSecret, payload } = await service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: service.hashPlaintextSecret("old-secret"),
      actor: "operator",
      now: new Date("2026-05-25T01:00:00.000Z"),
    });
    const verified = await service.markNewSecretVerified(payload, {
      actor: "tribe-owner",
      now: new Date("2026-05-25T02:00:00.000Z"),
    });

    const revoked = await service.revokeOldSecret(verified, {
      actor: "operator",
      now: new Date("2026-05-25T03:00:00.000Z"),
    });

    expect(revoked.rotationState).toBe("old_revoked");
    expect(revoked.nextSecretHashSha256).toBeUndefined();
    expect(service.validatePlaintextSecret(revoked, "old-secret")).toEqual({
      valid: false,
      matched: null,
      rotationState: "old_revoked",
    });
    expect(service.validatePlaintextSecret(revoked, plaintextSecret)).toEqual({
      valid: true,
      matched: "current",
      rotationState: "old_revoked",
    });
  });

  it("returns accepted hashes for Secret Manager resolver payloads", () => {
    const current = service.hashPlaintextSecret("old-secret");
    const next = service.hashPlaintextSecret("new-secret");

    expect(
      service.getAcceptedSecretHashes({
        serviceId: "logistics",
        secretHashSha256: current,
        nextSecretHashSha256: next,
        status: "active",
        rotationState: "active_dual_valid",
      }),
    ).toEqual([current, next]);
    expect(
      service.getAcceptedSecretHashes({
        serviceId: "logistics",
        secretHashSha256: current,
        nextSecretHashSha256: next,
        status: "active",
        rotationState: "old_revoked",
      }),
    ).toEqual([current]);
  });
});
