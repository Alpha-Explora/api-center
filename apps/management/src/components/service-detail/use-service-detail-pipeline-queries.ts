import { useQuery } from "@tanstack/react-query";
import {
  getDataPipelineCost,
  getDataPipelineDecisionSignals,
  getDataPipelineGatewayDecisions,
  getDataPipelineHealth,
  getDataPipelineQuality,
  getDataPipelineSharedServiceUsage,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { PipelinePartitionDate, ServiceRegistryEntry } from "@/lib/schemas";
import {
  toPipelineLane,
  type RuntimeEnvironment,
} from "@/lib/environment-names";
import type { DetailSection } from "@/components/service-detail/service-detail-navigation";

type UseServiceDetailPipelineQueriesInput = {
  service: ServiceRegistryEntry | undefined;
  section: DetailSection;
  environment: RuntimeEnvironment;
  partition: PipelinePartitionDate | undefined;
  partitionKey: string;
};

export function useServiceDetailPipelineQueries({
  service,
  section,
  environment,
  partition,
  partitionKey,
}: UseServiceDetailPipelineQueriesInput) {
  const enabled = pipelineHealthQueryEnabled(service, section);
  const pipelineLane = toPipelineLane(environment);

  return {
    pipelineHealthQuery: useQuery({
      queryKey: queryKeys.dataPipelineHealth(pipelineLane, partitionKey),
      queryFn: () => getDataPipelineHealth(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
    pipelineQualityQuery: useQuery({
      queryKey: queryKeys.dataPipelineQuality(pipelineLane, partitionKey),
      queryFn: () => getDataPipelineQuality(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
    pipelineSharedServiceUsageQuery: useQuery({
      queryKey: queryKeys.dataPipelineSharedServiceUsage(
        pipelineLane,
        partitionKey,
      ),
      queryFn: () =>
        getDataPipelineSharedServiceUsage(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
    pipelineGatewayDecisionQuery: useQuery({
      queryKey: queryKeys.dataPipelineGatewayDecisions(
        pipelineLane,
        partitionKey,
      ),
      queryFn: () =>
        getDataPipelineGatewayDecisions(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
    pipelineCostQuery: useQuery({
      queryKey: queryKeys.dataPipelineCost(pipelineLane, partitionKey),
      queryFn: () => getDataPipelineCost(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
    pipelineDecisionSignalQuery: useQuery({
      queryKey: queryKeys.dataPipelineDecisionSignals(
        pipelineLane,
        partitionKey,
      ),
      queryFn: () => getDataPipelineDecisionSignals(pipelineLane, partition),
      enabled,
      retry: 1,
    }),
  };
}

function pipelineHealthQueryEnabled(
  service: ServiceRegistryEntry | undefined,
  section: DetailSection,
) {
  return (
    Boolean(service) &&
    section === "pipeline" &&
    (service?.serviceType ?? "tribe") === "tribe"
  );
}
