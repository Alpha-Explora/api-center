import { CostInsightsClient } from "@/components/cost-insights-client";
import { PageHeading } from "@/components/page-heading";
import { PlatformAdminOnly } from "@/components/platform-admin-only";

export default function CostPage() {
  return <PlatformAdminOnly>
    <div className="flex flex-col gap-6">
      <PageHeading title="Cost signals" description="Review shared-service provider usage that can drive operational cost." />
      <CostInsightsClient />
    </div>
  </PlatformAdminOnly>;
}
