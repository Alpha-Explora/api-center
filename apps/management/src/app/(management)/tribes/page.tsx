import { TribeListClient } from "@/components/tribe-list-client";
import { PageHeading } from "@/components/page-heading";

export default function TribesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Registry"
        description="API Center service manifests, grouped by tribe and shared-service routing type."
      />
      <TribeListClient />
    </div>
  );
}
