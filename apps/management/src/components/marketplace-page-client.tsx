"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiMarketplaceClient } from "@/components/api-marketplace-client";
import { DeprecationWorkflowPanel } from "@/components/deprecation-workflow-panel";
import { ActionFailedState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { listMarketplaceProducts } from "@/lib/api-center-client";
import { withTimeout } from "@/lib/promise-timeout";
import { queryKeys } from "@/lib/query-keys";

export function MarketplacePageClient() {
  const productsQuery = useQuery({
    queryKey: queryKeys.marketplaceProducts,
    queryFn: () =>
      withTimeout(
        listMarketplaceProducts(),
        3000,
        "Marketplace data request timed out.",
      ),
    retry: false,
  });

  if (productsQuery.isLoading) {
    return <Skeleton className="h-72" />;
  }

  if (productsQuery.isError || !productsQuery.data) {
    return (
      <ActionFailedState
        title="Marketplace unavailable"
        description="API product data could not be loaded. Check the local management API configuration and try again."
        recoverySteps={[
          {
            label: "Check management API base URL",
            description:
              "Confirm the local management API route is reachable from this app session.",
          },
          {
            label: "Reload the marketplace",
            description:
              "Return here after the local API responds so product onboarding can continue.",
          },
        ]}
      />
    );
  }

  return (
    <>
      <ApiMarketplaceClient products={productsQuery.data} />
      <DeprecationWorkflowPanel deprecations={[]} />
    </>
  );
}
