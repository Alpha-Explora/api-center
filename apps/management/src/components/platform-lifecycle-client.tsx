"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getPlatformLifecycleEvidence,
  getQuotaUsage,
  listQuotaPolicies,
  listServices,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { PlatformLifecyclePanel } from "@/components/platform-lifecycle-panel";
import { ActionFailedState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

export function PlatformLifecycleClient() {
  const lifecycleQuery = useQuery({
    queryKey: queryKeys.platformLifecycle,
    queryFn: getPlatformLifecycleEvidence,
    retry: false,
  });
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
    enabled: lifecycleQuery.isError,
  });
  const quotaPoliciesQuery = useQuery({
    queryKey: queryKeys.quotaPolicies("all"),
    queryFn: () => listQuotaPolicies(),
    enabled: lifecycleQuery.isError,
    retry: 1,
  });
  const quotaUsageQuery = useQuery({
    queryKey: queryKeys.quotaUsage("all", "24h"),
    queryFn: () => getQuotaUsage({ window: "24h" }),
    enabled: lifecycleQuery.isError,
    retry: 1,
  });

  if (
    lifecycleQuery.isLoading ||
    (lifecycleQuery.isError && servicesQuery.isLoading)
  ) {
    return <Skeleton className="h-[30rem] rounded-xl" />;
  }

  if (lifecycleQuery.data) {
    return <PlatformLifecyclePanel lifecycle={lifecycleQuery.data} />;
  }

  if (servicesQuery.isError || !servicesQuery.data) {
    return (
      <ActionFailedState
        title="Could not load lifecycle state"
        description="Check API Center registry availability and management credentials."
        recoverySteps={[
          {
            label: "Check registry availability",
            description:
              "Lifecycle fallback still needs the service registry to derive state.",
          },
          {
            label: "Verify management credentials",
            description:
              "Confirm the local management session can read registry services.",
          },
        ]}
      />
    );
  }

  return (
    <PlatformLifecyclePanel
      services={servicesQuery.data}
      quotaPolicies={quotaPoliciesQuery.data ?? []}
      quotaUsage={quotaUsageQuery.data ?? []}
    />
  );
}
