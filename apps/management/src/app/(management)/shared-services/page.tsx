import { PageHeading } from "@/components/page-heading";
import { SharedServicesCatalogClient } from "@/components/shared-services-catalog-client";

export default function SharedServicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Shared services"
        description="Catalog the shared-service wrappers, check their registry status, and open setup or usage views from one place."
      />
      <SharedServicesCatalogClient />
    </div>
  );
}
