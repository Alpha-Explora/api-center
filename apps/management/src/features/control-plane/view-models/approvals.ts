"use client";
import { useQuery } from "@tanstack/react-query";
import { approvals, type ApprovalsState } from "../data/approvals";
import { cpKeys } from "./query-keys";
import { useOrganization } from "./use-organization";

/**
 * What waits for a decision. Platform operators see every organization's items; anyone else sees the
 * current organization's items that their role lets them decide.
 */
export function useApprovals(state: ApprovalsState = "pending", options: { enabled?: boolean } = {}) {
  const { organizationId, platformAdmin, session } = useOrganization();
  const scope = platformAdmin ? "platform" : organizationId ? { organizationId } : undefined;
  const query = useQuery({
    queryKey: scope ? [...cpKeys.approvals(scope), state] : cpKeys.approvalsRoot,
    queryFn: () =>
      scope === "platform" ? approvals.all(state) : approvals.forOrganization((scope as { organizationId: string }).organizationId, state),
    enabled: Boolean(session) && scope !== undefined && (options.enabled ?? true),
    staleTime: 30_000,
    ...(state === "pending" ? { refetchInterval: 120_000 } : {}),
  });
  return { ...query, platformAdmin };
}
