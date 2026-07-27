import { SharedServiceUsageMatrix } from "@/components/shared-service-usage-matrix";
import { PageHeading } from "@/components/page-heading";
import { SdkToS3ValidationFlow } from "@/components/workflows/sdk-to-s3-validation-flow";

export default function SharedServiceUsagePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Shared-service usage"
        description="See which tribes are configured to consume each platform shared service, then compare that registry declaration against API Center runtime call counts when the analytics endpoint is deployed."
      />
      <SharedServiceUsageMatrix />
      <SdkToS3ValidationFlow
        sdkConfigured
        gatewayEventsSeen={false}
        kafkaEventsSeen={false}
        s3ObjectsSeen={false}
      />
    </div>
  );
}
