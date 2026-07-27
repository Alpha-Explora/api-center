import { ApiProductCatalog } from "@/components/api-product-catalog";
import { PageHeading } from "@/components/page-heading";

export default function ApiCatalogPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="API catalog"
        description="Review registered tribe and shared-service APIs as governed platform products."
      />
      <ApiProductCatalog />
    </div>
  );
}
