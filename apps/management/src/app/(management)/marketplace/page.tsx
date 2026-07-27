import { MarketplacePageClient } from "@/components/marketplace-page-client";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

export default function MarketplacePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Marketplace"
        description="Browse API and shared-service products with onboarding and deprecation status."
      />
      <MarketplacePageClient />
    </div>
  );
}
