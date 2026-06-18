import type { AuthService } from "../../auth/auth.service";
import type { EmergencyControlService } from "../../operations/emergency-control.service";
import type { RegistryService } from "../../registry/registry.service";
import type { AuthenticatedRequest } from "../../types";
import { ForbiddenError } from "../errors";

export type EnforceProxyAuthContextInput = {
  registry: RegistryService;
  auth: AuthService;
  emergencyControls: EmergencyControlService;
  targetServiceId: string;
  tribeId: string;
  req: AuthenticatedRequest;
};

export function enforceProxyAuthContext({
  registry,
  auth,
  emergencyControls,
  targetServiceId,
  tribeId,
  req,
}: EnforceProxyAuthContextInput): void {
  const emergency = emergencyControls.evaluate({
    ownerTribeId: tribeId,
    serviceId: targetServiceId,
  });

  if (!emergency.allowed) {
    throw new ForbiddenError(`Emergency control active: ${emergency.reason}`);
  }

  if (!registry.canAccess(tribeId, targetServiceId)) {
    throw new ForbiddenError(
      `Tribe '${tribeId}' is not authorised to access '${targetServiceId}'`,
    );
  }

  const requiredScopes = registry.getRequiredScopes(targetServiceId);
  if (requiredScopes.length > 0 && req.user) {
    const missingScopes = auth.checkScopes(req, requiredScopes);
    if (missingScopes.length > 0) {
      throw new ForbiddenError(
        `Insufficient scopes for '${targetServiceId}'. Missing: ${missingScopes.join(", ")}`,
      );
    }
  }
}
