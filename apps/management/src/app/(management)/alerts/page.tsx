import { AlertsClient } from "@/components/alerts-client";
import { PageHeading } from "@/components/page-heading";

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Alerts"
        description="View read-only operational alerts from registry and runtime analytics."
      />
      <AlertsClient />
    </div>
  );
}
