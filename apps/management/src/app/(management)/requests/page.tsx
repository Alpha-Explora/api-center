import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { PlatformAdminOnly } from "@/components/platform-admin-only";
import { RequestDiagnosticsPanel } from "@/features/operations/diagnostics/views/request-diagnostics-panel";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return (
    <PlatformAdminOnly>
      <PageHeader title="Requests" description="Look up a gateway request by its correlation ID to see its status and where it failed." />
      <RequestDiagnosticsPanel />
    </PlatformAdminOnly>
  );
}
