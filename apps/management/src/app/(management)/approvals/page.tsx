import type { Metadata } from "next";
import { ApprovalsPage } from "@/features/control-plane/views/approvals/approvals-page";

export const metadata: Metadata = { title: "Approvals" };

export default function Page() {
  return <ApprovalsPage />;
}
