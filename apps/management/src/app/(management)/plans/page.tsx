import { PageHeading } from "@/components/page-heading";
import { TribePlanTierPanel } from "@/components/tribe-plan-tier-panel";

export default function PlansPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Tribe plans"
        description="Package quota defaults, shared-service access expectations, retention, and support tiers into managed tribe plans."
      />
      <TribePlanTierPanel />
    </div>
  );
}
