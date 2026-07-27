import { EditServiceClient } from "@/components/edit-service-client";
import { PageHeading } from "@/components/page-heading";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ tribeId: string }>;
}) {
  const { tribeId } = await params;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading
        title="Edit service"
        description="Updates are submitted through the existing API Center register endpoint using the same service ID."
      />
      <EditServiceClient serviceId={tribeId} />
    </div>
  );
}
