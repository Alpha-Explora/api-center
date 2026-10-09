import { DataPipelineDashboardClient } from "@/components/data-pipeline-dashboard-client";
import { PageHeading } from "@/components/page-heading";
import { PlatformAdminOnly } from "@/components/platform-admin-only";
import { getNorthStarBiConfig } from "@/lib/server/north-star-bi-config";

export default function DataPipelinePage() {
  const biConfig = getNorthStarBiConfig();
  return <PlatformAdminOnly>
    <div className="flex flex-col gap-6">
      <PageHeading title="Data pipeline" description="Answer the north-star traceability question across publishing, gateway decisions, S3 export, governed BI, and Athena cost signals." />
      <DataPipelineDashboardClient biConfig={biConfig} />
    </div>
  </PlatformAdminOnly>;
}
