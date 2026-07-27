import { IncidentSupportPanel } from "@/components/incident-support-panel";
import { PageHeading } from "@/components/page-heading";
import { TribeReliabilityPanel } from "@/components/tribe-reliability-panel";

export default async function ReliabilityPage({
  searchParams,
}: {
  searchParams?: Promise<{ tribeId?: string; target?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Reliability"
        description="Review tribe reliability signals and incident evidence across gateway, quota, Kafka, and shared-service activity."
      />
      <TribeReliabilityPanel initialTribeId={params?.tribeId?.trim() ?? ""} />
      <IncidentSupportPanel initialTarget={params?.target?.trim() ?? ""} />
    </div>
  );
}
