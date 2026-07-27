import { SharedServicesSetupClient } from "@/components/shared-services-setup-client";
import { PageHeading } from "@/components/page-heading";
import { PaymentSubscriptionRolloutFlow } from "@/components/workflows/payment-subscription-rollout-flow";
import { getManagementEnvironment } from "@/lib/management-environment";
import { PaymentConsumerServicePanel } from "@/components/payment-consumer-service-panel";

export default function SharedServicesSetupPage() {
  const environment = getManagementEnvironment();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Shared services setup"
        description="Register the platform shared-service manifests through API Center. Keep this flow local until admin auth is added."
      />
      <PaymentSubscriptionRolloutFlow
        mode={environment.isLive ? "live" : "test"}
        checkoutReady
        subscriptionReady
        webhookReady={false}
      />
      <PaymentConsumerServicePanel />
      <SharedServicesSetupClient />
    </div>
  );
}
