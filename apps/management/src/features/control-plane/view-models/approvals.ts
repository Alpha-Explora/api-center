"use client";
import { useQuery } from "@tanstack/react-query";
import { approvals } from "../data/approvals";
import { cpKeys } from "./query-keys";
import { useOrganization } from "./use-organization";

/**
 * What waits for a decision. Platform operators see every organization's items; anyone else sees the
 * current organization's items that their role lets them decide.
 */
export function useApprovals() {
  const { organizationId, platformAdmin, session } = useOrganization();
  const scope = platformAdmin ? "platform" : organizationId ? { organizationId } : undefined;
  const query = useQuery({
    queryKey: scope ? cpKeys.approvals(scope) : cpKeys.approvalsRoot,
    queryFn: () => (scope === "platform" ? approvals.all() : approvals.forOrganization((scope as { organizationId: string }).organizationId)),
    enabled: Boolean(session) && scope !== undefined,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  return { ...query, platformAdmin };
}
