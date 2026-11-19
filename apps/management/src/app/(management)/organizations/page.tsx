import type { Metadata } from "next";
import { OrganizationsPage } from "@/features/control-plane/views/organizations/organizations-page";

export const metadata: Metadata = { title: "Organizations" };

export default function Page() {
  return <OrganizationsPage />;
}
