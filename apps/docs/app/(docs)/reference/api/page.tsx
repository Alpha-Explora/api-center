import { ApiReference } from "@/components/api-reference";
import { getApiOperations, getContractVersion } from "@/lib/contracts";

export const metadata = { title: "API Reference" };

export default function ApiReferencePage() {
  const operations = getApiOperations();
  const versions = getContractVersion();
  return <><div className="page-heading"><span className="eyebrow">OpenAPI {versions.openapi}</span><h1>API Reference</h1><p>Authenticated, provider-neutral HTTP operations for registered consumer services. Request and response shapes are sourced from the checked-in public contract.</p></div><ApiReference operations={operations} /></>;
}