"use client";

import { ConfluentPipelineStatusPanel } from "@/components/confluent-pipeline-status-panel";
import { ConfluentProvisioningCard } from "@/components/confluent-provisioning-card";
import { DataPipelineCostPanel } from "@/components/data-pipeline-cost-panel";
import { DataPipelineGovernancePanel } from "@/components/data-pipeline-governance-panel";
import {
  DataPipelineHealthPanel,
  type PipelineHealthRow,
} from "@/components/data-pipeline-health-panel";
import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
  ServiceRegistryEntry,
} from "@/lib/schemas";

export function ServicePipelinePanel({
  service,
  mode,
  pipelineHealthRows = [],
  pipelineHealthLoading = false,
  qualityRows = [],
  sharedServiceUsageRows = [],
  gatewayDecisionRows = [],
  decisionSignalRows = [],
  costRows = [],
  governanceLoading = false,
}: {
  service: ServiceRegistryEntry;
  mode: "onboarding" | "observability";
  pipelineHealthRows?: PipelineHealthRow[];
  pipelineHealthLoading?: boolean;
  qualityRows?: PipelineQualityRow[];
  sharedServiceUsageRows?: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows?: PipelineGatewayDecisionRow[];
  decisionSignalRows?: PipelineDecisionSignalRow[];
  costRows?: PipelineAthenaCostRow[];
  governanceLoading?: boolean;
}) {
  const serviceType = service.serviceType ?? "tribe";
  const isTribe = serviceType === "tribe";

  if (mode === "observability") {
    if (!isTribe) return null;
    const tribeId = service.ownerTribeId ?? service.serviceId;
    const serviceScopedHealthRows = pipelineHealthRows.filter(
      (row) =>
        row.tribeId === tribeId || row.sourceServiceId === service.serviceId,
    );
    const serviceScopedQualityRows = qualityRows.filter(
      (row) =>
        row.tribeId === tribeId || row.sourceServiceId === service.serviceId,
    );
    const serviceScopedSharedUsageRows = sharedServiceUsageRows.filter(
      (row) => row.tribeId === tribeId,
    );
    const serviceScopedGatewayRows = gatewayDecisionRows.filter(
      (row) =>
        row.tribeId === tribeId || row.sourceServiceId === service.serviceId,
    );
    const serviceScopedDecisionSignalRows = decisionSignalRows.filter(
      (row) =>
        row.tribeId === tribeId || row.sourceServiceId === service.serviceId,
    );

    return (
      <>
        <DataPipelineHealthPanel
          rows={serviceScopedHealthRows}
          loading={pipelineHealthLoading}
        />
        <DataPipelineGovernancePanel
          qualityRows={serviceScopedQualityRows}
          sharedServiceUsageRows={serviceScopedSharedUsageRows}
          gatewayDecisionRows={serviceScopedGatewayRows}
          decisionSignalRows={serviceScopedDecisionSignalRows}
          loading={governanceLoading}
        />
        <DataPipelineCostPanel
          rows={costRows}
          loading={governanceLoading}
          scopeLabel="Platform-wide Athena workgroup scan volume; not service-scoped."
        />
      </>
    );
  }

  return (
    <>
      <ConfluentProvisioningCard
        serviceId={service.serviceId}
        ownerTribeId={service.ownerTribeId}
        serviceType={serviceType}
      />
      <ConfluentPipelineStatusPanel
        serviceId={service.serviceId}
        ownerTribeId={service.ownerTribeId}
        serviceType={serviceType}
      />
    </>
  );
}
