import type { AuthService } from "@auth/auth.service";
import type { EmergencyControlService } from "@operations/emergency-control.service";
import type { RegistryService } from "@registry/registry.service";
import type { AuthenticatedRequest } from "../../types";
import { ForbiddenError } from "../errors";

export type EnforceProxyAuthContextInput = {
  registry: RegistryService;
  auth: AuthService;
  emergencyControls: EmergencyControlService;
  targetServiceId: string;
  /** The calling service; access is decided per service, never per tribe. */
  sourceServiceId: string;
  tribeId: string;
  req: AuthenticatedRequest;
};

export function enforceProxyAuthContext({
  registry,
  auth,
  emergencyControls,
  targetServiceId,
  sourceServiceId,
  tribeId,
  req,
}: EnforceProxyAuthContextInput): void {
  const emergency = emergencyControls.evaluate({
    ownerTribeId: tribeId,
    projectId: req.projectId,
    sourceServiceId,
    serviceId: targetServiceId,
  });

  if (!emergency.allowed) {
    throw new ForbiddenError(`Emergency control active: ${emergency.reason}`);
  }

  if (!registry.canAccess(sourceServiceId, targetServiceId)) {
    throw new ForbiddenError(
      `Service '${sourceServiceId}' is not authorised to access '${targetServiceId}'`,
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
