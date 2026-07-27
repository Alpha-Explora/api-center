"use client";

import { useQuery } from "@tanstack/react-query";
import { OperationalTrustClient } from "@/components/operational-trust-client";
import { EmergencyControlWorkflow } from "@/components/emergency-control-workflow";
import { ActionFailedState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getOperationalTrustData } from "@/lib/api-center-client";
import { withTimeout } from "@/lib/promise-timeout";
import { queryKeys } from "@/lib/query-keys";

export function OperationalTrustPageClient() {
  const trustQuery = useQuery({
    queryKey: [...queryKeys.governanceDrift, "operational-trust"],
    queryFn: () =>
      withTimeout(
        getOperationalTrustData(),
        3000,
        "Operational trust request timed out.",
      ),
    retry: false,
  });

  if (trustQuery.isLoading) {
    return <Skeleton className="h-96" />;
  }

  if (trustQuery.isError || !trustQuery.data) {
    return (
      <div className="space-y-6">
        <ActionFailedState
          title="Operational trust unavailable"
          description="Operational trust data could not be loaded. Review the management API base URL and analytics endpoint configuration."
          recoverySteps={[
            {
              label: "Check analytics endpoints",
              description:
                "Confirm drift, scorecard, and provider-usage data are reachable.",
            },
            {
              label: "Open readiness checks",
              description:
                "Verify the local management API before changing governance inputs.",
            },
          ]}
        />
        <EmergencyControlWorkflow />
      </div>
    );
  }

  return <OperationalTrustClient {...trustQuery.data} />;
}
