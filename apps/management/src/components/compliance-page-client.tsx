"use client";

import { useQuery } from "@tanstack/react-query";
import { ComplianceExportPanel } from "@/components/compliance-export-panel";
import { ConsumerScorecardPanel } from "@/components/consumer-scorecard-panel";
import { ActionFailedState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getConsumerScorecards } from "@/lib/api-center-client";
import { withTimeout } from "@/lib/promise-timeout";
import { queryKeys } from "@/lib/query-keys";

export function CompliancePageClient() {
  const scorecardsQuery = useQuery({
    queryKey: queryKeys.consumerScorecards,
    queryFn: () =>
      withTimeout(
        getConsumerScorecards(),
        3000,
        "Consumer scorecard request timed out.",
      ),
    retry: false,
  });

  if (scorecardsQuery.isLoading) {
    return (
      <>
        <ComplianceExportPanel />
        <Skeleton className="h-64" />
      </>
    );
  }

  if (scorecardsQuery.isError || !scorecardsQuery.data) {
    return (
      <>
        <ComplianceExportPanel />
        <ActionFailedState
          title="Scorecards unavailable"
          description="Consumer scorecards could not be loaded. The compliance export remains available while the scorecard endpoint is repaired."
          recoverySteps={[
            {
              label: "Continue with compliance export",
              description:
                "The export form is still usable for audit evidence packets.",
            },
            {
              label: "Check scorecard endpoint health",
              description:
                "Use readiness checks before treating this as a consumer compliance issue.",
            },
          ]}
        />
      </>
    );
  }

  return (
    <>
      <ComplianceExportPanel />
      <ConsumerScorecardPanel scorecards={scorecardsQuery.data} />
    </>
  );
}
