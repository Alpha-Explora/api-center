"use client";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { observability } from "../data/observability";
import type { EnvironmentKind } from "../model/control-plane";
import { auditSearch, requestLogSearch, type AuditFilters, type RequestLogFilters, type UsageRange } from "../model/observability";
import { cpKeys } from "./query-keys";

/** Query keys under the environment (or organization), so invalidating it refreshes these too. */
export const observabilityKeys = {
  requests: (organizationId: string, projectId: string, kind: EnvironmentKind, filters: RequestLogFilters, now: number) =>
    [...cpKeys.environment(organizationId, projectId, kind), "requests", filters, now] as const,
  usageSeries: (organizationId: string, projectId: string, kind: EnvironmentKind, range: UsageRange) =>
    [...cpKeys.environment(organizationId, projectId, kind), "usage-series", range] as const,
  quotaUsage: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    [...cpKeys.environment(organizationId, projectId, kind), "quota-usage"] as const,
  sharedQuotaUsage: (organizationId: string) => ["cp", organizationId, "quota-usage"] as const,
  audit: (organizationId: string, filters: AuditFilters, now: number, limit: number) => ["cp", organizationId, "audit-events", filters, now, limit] as const,
};

/**
 * A time window anchored when the filters were last applied, so "Load more" pages line up and a refresh
 * moves the window forward.
 */
export function useAnchoredNow() {
  const [now, setNow] = useState(() => Date.now());
  return { now, refresh: () => setNow(Date.now()) };
}

export function useRequestLog(organizationId: string, projectId: string, kind: EnvironmentKind, filters: RequestLogFilters, now: number) {
  return useInfiniteQuery({
    queryKey: observabilityKeys.requests(organizationId, projectId, kind, filters, now),
    queryFn: ({ pageParam }) => observability.requests(organizationId, projectId, kind, requestLogSearch(filters, now, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

export function useAuditLog(organizationId: string | undefined, filters: AuditFilters, now: number, options: { limit?: number; enabled?: boolean } = {}) {
  const limit = options.limit ?? 50;
  return useInfiniteQuery({
    queryKey: observabilityKeys.audit(organizationId ?? "none", filters, now, limit),
    queryFn: ({ pageParam }) => observability.auditEvents(organizationId as string, auditSearch(filters, now, pageParam, limit)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(organizationId) && (options.enabled ?? true),
    retry: false,
  });
}

export function useQuotaUsage(organizationId: string, projectId: string, kind: EnvironmentKind) {
  return useQuery({
    queryKey: observabilityKeys.quotaUsage(organizationId, projectId, kind),
    queryFn: () => observability.quotaUsage(organizationId, projectId, kind),
    retry: false,
    refetchInterval: 60_000,
  });
}
