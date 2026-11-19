import { PageHeading } from "@/components/page-heading";
import { RequestDiagnosticsPanel } from "@/features/operations/diagnostics/views/request-diagnostics-panel";

export default function RequestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Requests"
        description="Recent requests through the gateway: the application, route, status and where a failure happened."
      />
      <RequestDiagnosticsPanel />
    </div>
  );
}
