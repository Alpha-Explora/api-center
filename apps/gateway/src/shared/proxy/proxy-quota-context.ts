import type { TribeQuotaEnforcerService } from "@quotas/tribe-quota-enforcer.service";
import type { TribeQuotaScope } from "@quotas/tribe-quota-policy.types";
import type { ServiceType } from "../../types";
import { requireGovernanceDependency } from "../governance-dependencies";

export type CheckProxyQuotaInput = {
  quotaEnforcer: TribeQuotaEnforcerService;
  ownerTribeId: string;
  projectId?: string;
  namespace: ServiceType;
  targetServiceId: string;
  correlationId?: string;
  environment?: string;
};

export async function checkProxyQuota({
  quotaEnforcer,
  ownerTribeId,
  projectId,
  namespace,
  targetServiceId,
  correlationId,
  environment,
}: CheckProxyQuotaInput): Promise<void> {
  const enforcer = requireGovernanceDependency(
    quotaEnforcer,
    "TribeQuotaEnforcerService",
  );

  await enforcer.check({
    ownerTribeId,
    projectId,
    scope: namespace as TribeQuotaScope,
    targetServiceId,
    routeFamily: `${namespace}:${targetServiceId}`,
    correlationId,
    environment,
  });
}
