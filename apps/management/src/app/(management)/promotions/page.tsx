import { EnvironmentPromotionPanel } from "@/components/environment-promotion-panel";
import { PageHeading } from "@/components/page-heading";

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ serviceId?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Environment promotions"
        description="Check live-readiness gates before moving a tribe or service from test to live."
      />
      <EnvironmentPromotionPanel initialServiceId={params?.serviceId ?? ""} />
    </div>
  );
}
