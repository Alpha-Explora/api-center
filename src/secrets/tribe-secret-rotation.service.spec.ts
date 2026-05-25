import { TribeSecretRotationService } from "./tribe-secret-rotation.service";

describe("TribeSecretRotationService", () => {
  let service: TribeSecretRotationService;

  beforeEach(() => {
    service = new TribeSecretRotationService();
  });

  it("starts rotation with active_dual_valid state and one-time plaintext secret", () => {
    const currentHash = service.hashPlaintextSecret("old-secret");
    const result = service.startRotation({
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
  });

  it("validates current and next secrets during the dual-valid window", () => {
    const currentHash = service.hashPlaintextSecret("old-secret");
    const { plaintextSecret, payload } = service.startRotation({
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

  it("moves to old_pending_revoke after the tribe verifies the new secret", () => {
    const { payload } = service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: service.hashPlaintextSecret("old-secret"),
      actor: "operator",
      now: new Date("2026-05-25T01:00:00.000Z"),
    });

    const verified = service.markNewSecretVerified(payload, {
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

  it("revokes the old secret and only accepts the replacement secret", () => {
    const { plaintextSecret, payload } = service.startRotation({
      serviceId: "logistics",
      currentSecretHashSha256: service.hashPlaintextSecret("old-secret"),
      actor: "operator",
      now: new Date("2026-05-25T01:00:00.000Z"),
    });
    const verified = service.markNewSecretVerified(payload, {
      actor: "tribe-owner",
      now: new Date("2026-05-25T02:00:00.000Z"),
    });

    const revoked = service.revokeOldSecret(verified, {
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
