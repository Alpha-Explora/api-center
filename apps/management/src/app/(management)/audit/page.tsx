import { Suspense } from "react";
import type { Metadata } from "next";
import { AuditLogPage } from "@/features/control-plane/views/audit/audit-log-page";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return (
    <Suspense>
      <AuditLogPage />
    </Suspense>
  );
}
