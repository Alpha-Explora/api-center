import type { Metadata } from "next";
import { ApiCatalogPage } from "@/features/control-plane/views/apis/api-catalog-page";

export const metadata: Metadata = { title: "API catalog" };

export default function Page() {
  return <ApiCatalogPage />;
}
