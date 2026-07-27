import { AuditLogClient } from "@/components/audit-log-client";
import { PageHeading } from "@/components/page-heading";

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{
    actionFamily?: string;
    serviceId?: string;
    type?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Audit log"
        description="Inspect recent registry, proxy, Kafka, and readiness events captured by API Center."
      />
      <AuditLogClient
        defaultActionFamily={params?.actionFamily}
        defaultServiceId={params?.serviceId}
        defaultType={params?.type}
      />
    </div>
  );
}
