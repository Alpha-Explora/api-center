"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { platformAudit } from "../data/platform-audit";
import { auditSearch, type AuditFilters } from "../model/observability";

/** The platform-wide audit log, for platform operators. */
export function usePlatformAuditLog(filters: AuditFilters, now: number, options: { enabled: boolean; limit?: number }) {
  const limit = options.limit ?? 50;
  // A project ID names one organization's project; across organizations only actor, action and time filter.
  const scoped = { ...filters, projectId: undefined };
  return useInfiniteQuery({
    queryKey: ["cp", "platform", "audit-events", scoped, now, limit] as const,
    queryFn: ({ pageParam }) => platformAudit.events(auditSearch(scoped, now, pageParam, limit)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: options.enabled,
    retry: false,
  });
}
