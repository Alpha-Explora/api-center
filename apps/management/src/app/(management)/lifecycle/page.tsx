import { PageHeading } from "@/components/page-heading";
import { PlatformLifecycleClient } from "@/components/platform-lifecycle-client";

export default function LifecyclePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Service lifecycle"
        description="Track every service from registry through runtime, quota, pipeline, promotion, and evidence readiness."
      />
      <PlatformLifecycleClient />
    </div>
  );
}
