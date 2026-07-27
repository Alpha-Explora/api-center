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
import type { PipelinePartitionDate } from "@/lib/schemas";
import {
  toPipelineLane,
  type RuntimeEnvironment,
} from "@/lib/environment-names";

type UseDataPipelineDashboardQueriesInput = {
  environment: RuntimeEnvironment;
  partition: PipelinePartitionDate | undefined;
  partitionKey: string;
  windowDays: number;
};

export function useDataPipelineDashboardQueries({
  environment,
  partition,
  partitionKey,
  windowDays,
}: UseDataPipelineDashboardQueriesInput) {
  const pipelineLane = toPipelineLane(environment);

  return {
    healthQuery: useQuery({
      queryKey: queryKeys.dataPipelineHealth(pipelineLane, partitionKey),
      queryFn: () => getDataPipelineHealth(pipelineLane, partition),
      retry: 1,
    }),
    qualityQuery: useQuery({
      queryKey: queryKeys.dataPipelineQuality(
        pipelineLane,
        partitionKey,
        windowDays,
      ),
      queryFn: () =>
        getDataPipelineQuality(pipelineLane, partition, windowDays),
      retry: 1,
    }),
    sharedServiceUsageQuery: useQuery({
      queryKey: queryKeys.dataPipelineSharedServiceUsage(
        pipelineLane,
        partitionKey,
        windowDays,
      ),
      queryFn: () =>
        getDataPipelineSharedServiceUsage(pipelineLane, partition, windowDays),
      retry: 1,
    }),
    gatewayDecisionQuery: useQuery({
      queryKey: queryKeys.dataPipelineGatewayDecisions(
        pipelineLane,
        partitionKey,
        windowDays,
      ),
      queryFn: () =>
        getDataPipelineGatewayDecisions(pipelineLane, partition, windowDays),
      retry: 1,
    }),
    costQuery: useQuery({
      queryKey: queryKeys.dataPipelineCost(
        pipelineLane,
        partitionKey,
        windowDays,
      ),
      queryFn: () => getDataPipelineCost(pipelineLane, partition, windowDays),
      retry: 1,
    }),
    decisionSignalQuery: useQuery({
      queryKey: queryKeys.dataPipelineDecisionSignals(
        pipelineLane,
        partitionKey,
        windowDays,
      ),
      queryFn: () =>
        getDataPipelineDecisionSignals(pipelineLane, partition, windowDays),
      retry: 1,
    }),
  };
}
