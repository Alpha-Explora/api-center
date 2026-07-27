import { CompliancePageClient } from "@/components/compliance-page-client";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Compliance"
        description="Prepare audit-ready packets and review consumer health signals."
      />
      <CompliancePageClient />
    </div>
  );
}
