import { PageHeading } from "@/components/page-heading";
import { TribeQuotaPolicyPanel } from "@/components/tribe-quota-policy-panel";
import { TribeQuotaUsagePanel } from "@/components/tribe-quota-usage-panel";
import type { QuotaMode, QuotaScope } from "@/lib/schemas";

const quotaScopes: QuotaScope[] = ["all", "shared", "tribe", "kafka_publish"];
const quotaModes: QuotaMode[] = ["observe", "enforce"];

export default async function QuotasPage({
  searchParams,
}: {
  searchParams?: Promise<{
    ownerTribeId?: string;
    scope?: string;
    targetServiceId?: string;
    windowSeconds?: string;
    maxRequests?: string;
    burstRequests?: string;
    mode?: string;
    reason?: string;
  }>;
}) {
  const params = await searchParams;
  const ownerTribeId = params?.ownerTribeId?.trim() || undefined;
  const initialPolicy = {
    ownerTribeId: ownerTribeId ?? "",
    scope: quotaScopes.includes(params?.scope as QuotaScope)
      ? (params?.scope as QuotaScope)
      : undefined,
    targetServiceId: params?.targetServiceId ?? "",
    windowSeconds: params?.windowSeconds ?? undefined,
    maxRequests: params?.maxRequests ?? undefined,
    burstRequests: params?.burstRequests ?? "",
    mode: quotaModes.includes(params?.mode as QuotaMode)
      ? (params?.mode as QuotaMode)
      : undefined,
    reason: params?.reason ?? undefined,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Tribe quotas"
        description="Configure per-tribe API call policies, review observe-mode impact, and inspect quota decisions emitted by API Center."
      />
      <TribeQuotaPolicyPanel
        ownerTribeId={ownerTribeId}
        initialPolicy={initialPolicy}
      />
      <TribeQuotaUsagePanel ownerTribeId={ownerTribeId} />
    </div>
  );
}
