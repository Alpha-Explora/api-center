import { ServiceDetailClient } from "@/components/service-detail-client";
import { PageHeading } from "@/components/page-heading";

export default async function TribeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tribeId: string }>;
  searchParams?: Promise<{ section?: string }>;
}) {
  const { tribeId } = await params;
  const query = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title={tribeId}
        description="Registry detail for this service ID."
      />

      <ServiceDetailClient serviceId={tribeId} initialSection={query?.section} />
    </div>
  );
}
