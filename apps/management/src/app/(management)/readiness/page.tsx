import { ReadinessClient } from "@/components/readiness-client";
import { PageHeading } from "@/components/page-heading";
import { PlatformAdminOnly } from "@/components/platform-admin-only";

export default function ReadinessPage() {
  return <PlatformAdminOnly>
    <div className="flex flex-col gap-6">
      <PageHeading title="Readiness" description="Check local API Center connectivity before changing registry data." />
      <ReadinessClient />
    </div>
  </PlatformAdminOnly>;
}
