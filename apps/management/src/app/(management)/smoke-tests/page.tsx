import { SharedServiceSmokeTests } from "@/components/shared-service-smoke-tests";
import { PageHeading } from "@/components/page-heading";
import { getManagementEnvironment } from "@/lib/management-environment";

export default async function SmokeTestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tribeId?: string }>;
}) {
  const params = await searchParams;
  const environment = getManagementEnvironment();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Smoke tests"
        description="Request a temporary tribe token locally, then run allowlisted checks through API Center shared-service proxy routes."
      />
      <SharedServiceSmokeTests
        defaultTribeId={params?.tribeId}
        mode={environment.isLive ? "live" : "test"}
      />
    </div>
  );
}
