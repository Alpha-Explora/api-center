import { DependencyMapClient } from "@/components/dependency-map-client";
import { PageHeading } from "@/components/page-heading";

export default function DependenciesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Dependencies"
        description="Registry relationships derived from service manifest consumes entries."
      />
      <DependencyMapClient />
    </div>
  );
}
