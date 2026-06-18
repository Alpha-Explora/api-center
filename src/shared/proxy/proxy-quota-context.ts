import type { TribeQuotaEnforcerService } from "../../quotas/tribe-quota-enforcer.service";
import type { TribeQuotaScope } from "../../quotas/tribe-quota-policy.types";
import type { ServiceType } from "../../types";
import { requireGovernanceDependency } from "../governance-dependencies";

export type CheckProxyQuotaInput = {
  quotaEnforcer: TribeQuotaEnforcerService;
  ownerTribeId: string;
  namespace: ServiceType;
  targetServiceId: string;
  correlationId?: string;
};

export async function checkProxyQuota({
  quotaEnforcer,
  ownerTribeId,
  namespace,
  targetServiceId,
  correlationId,
}: CheckProxyQuotaInput): Promise<void> {
  const enforcer = requireGovernanceDependency(
    quotaEnforcer,
    "TribeQuotaEnforcerService",
  );

  await enforcer.check({
    ownerTribeId,
    scope: namespace as TribeQuotaScope,
    targetServiceId,
    routeFamily: `${namespace}:${targetServiceId}`,
    correlationId,
  });
}
