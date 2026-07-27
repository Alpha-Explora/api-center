import { ReadinessClient } from "@/components/readiness-client";
import { PageHeading } from "@/components/page-heading";

export default function ReadinessPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Readiness"
        description="Check local API Center connectivity before changing registry data."
      />
      <ReadinessClient />
    </div>
  );
}
