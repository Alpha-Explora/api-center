import { TribeListClient } from "@/components/tribe-list-client";
import { TenancyTreePanel } from "@/components/tenancy-tree-panel";
import { PageHeading } from "@/components/page-heading";

export default function TribesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Registry"
        description="Tribes own projects, projects own services, and services hold their own credentials per environment."
      />
      <TenancyTreePanel />
      <TribeListClient />
    </div>
  );
}
