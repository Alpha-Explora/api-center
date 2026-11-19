import type { Metadata } from "next";
import { OrganizationQuotasPage } from "@/features/control-plane/views/quotas/organization-quotas-page";

export const metadata: Metadata = { title: "Quotas" };

export default function Page() {
  return <OrganizationQuotasPage />;
}
