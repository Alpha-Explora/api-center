// Pure access decision for one application request. Everything it needs is passed in, so the
// rules are testable without a database. Access requires an explicit active grant: project
// membership, sibling applications and enabled capabilities never imply permission.

import type { EnvironmentKind } from "./control-plane.types";

export interface AccessSnapshot {
  now: Date;
  /** Environment kind encoded in the presented key's prefix. */
  presentedKind: EnvironmentKind;
  organizationStatus: string;
  project: { status: string };
  environment: { kind: EnvironmentKind; status: string };
  application: { status: string };
  credential: { status: string; expiresAt: Date; environmentKind: EnvironmentKind };
  /** What the request targets: a platform capability (default) or a published API. */
  targetKind?: "capability" | "api";
  /** The target's installation (capability) or publication (API); status 'enabled' when usable. */
  capability: { id: string; status: string } | undefined;
  /** The catalogued action the request maps to; undefined when the route is not catalogued. */
  action: string | undefined;
  grants: { targetKind: string; targetId: string; action: string; status: string }[];
}

/** Authentication failures become 401; authorization failures become 403. */
export type AccessDenial =
  | { kind: "authentication"; code: "CREDENTIAL_REVOKED" | "CREDENTIAL_EXPIRED" | "CREDENTIAL_ENVIRONMENT_MISMATCH" }
  | {
      kind: "authorization";
      code:
        | "ORGANIZATION_INACTIVE"
        | "PROJECT_INACTIVE"
        | "ENVIRONMENT_INACTIVE"
        | "APPLICATION_INACTIVE"
        | "ACTION_NOT_CATALOGED"
        | "CAPABILITY_NOT_ENABLED"
        | "API_NOT_AVAILABLE"
        | "ACTION_NOT_GRANTED";
    };

export type AccessDecision = { allowed: true; action: string } | { allowed: false; denial: AccessDenial };

const deny = (denial: AccessDenial): AccessDecision => ({ allowed: false, denial });

export function decideCapabilityAccess(snapshot: AccessSnapshot): AccessDecision {
  const { credential, environment } = snapshot;

  if (credential.status !== "active") return deny({ kind: "authentication", code: "CREDENTIAL_REVOKED" });
  if (credential.expiresAt.getTime() <= snapshot.now.getTime()) {
    return deny({ kind: "authentication", code: "CREDENTIAL_EXPIRED" });
  }
  // The stored row is authoritative; a prefix that disagrees with it is treated as a forged key.
  if (credential.environmentKind !== environment.kind || snapshot.presentedKind !== environment.kind) {
    return deny({ kind: "authentication", code: "CREDENTIAL_ENVIRONMENT_MISMATCH" });
  }

  if (snapshot.organizationStatus !== "active") return deny({ kind: "authorization", code: "ORGANIZATION_INACTIVE" });
  if (snapshot.project.status !== "active") return deny({ kind: "authorization", code: "PROJECT_INACTIVE" });
  if (environment.status !== "active") return deny({ kind: "authorization", code: "ENVIRONMENT_INACTIVE" });
  if (snapshot.application.status !== "active") return deny({ kind: "authorization", code: "APPLICATION_INACTIVE" });

  const { action, capability } = snapshot;
  const targetKind = snapshot.targetKind ?? "capability";
  // An API that is absent, disabled or out of reach reads the same as one that does not exist.
  if (targetKind === "api" && (!capability || capability.status !== "enabled")) {
    return deny({ kind: "authorization", code: "API_NOT_AVAILABLE" });
  }
  if (!action) return deny({ kind: "authorization", code: "ACTION_NOT_CATALOGED" });
  if (!capability || capability.status !== "enabled") {
    return deny({ kind: "authorization", code: targetKind === "api" ? "API_NOT_AVAILABLE" : "CAPABILITY_NOT_ENABLED" });
  }

  const granted = snapshot.grants.some(
    (grant) =>
      grant.status === "active" &&
      grant.targetKind === targetKind &&
      grant.targetId === capability.id &&
      grant.action === action,
  );
  if (!granted) return deny({ kind: "authorization", code: "ACTION_NOT_GRANTED" });

  return { allowed: true, action };
}
