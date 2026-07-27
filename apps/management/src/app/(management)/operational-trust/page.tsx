import { OperationalTrustPageClient } from "@/components/operational-trust-page-client";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

export default function OperationalTrustPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Operational Trust"
        description="Review drift, runtime dependencies, promotion evidence, and consumer scorecards before live changes."
      />
      <OperationalTrustPageClient />
    </div>
  );
}
