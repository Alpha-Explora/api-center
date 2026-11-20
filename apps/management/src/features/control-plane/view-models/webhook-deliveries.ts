"use client";
import { useQuery } from "@tanstack/react-query";
import { webhookDeliveries } from "../data/webhook-deliveries";
import type { EnvironmentKind } from "../model/control-plane";
import { shouldPollForTestEvent } from "../model/webhook-deliveries";
import { cpKeys } from "./query-keys";

export const webhookDeliveriesKey = (organizationId: string, projectId: string, kind: EnvironmentKind, destinationId: string) =>
  [...cpKeys.environment(organizationId, projectId, kind), "event-destinations", destinationId, "deliveries"] as const;

/**
 * A webhook's recent attempts. While `followEventId` names a test event in flight, polls every few
 * seconds until that event is delivered, then stops.
 */
export function useWebhookDeliveries(
  scope: { organizationId: string; projectId: string; kind: EnvironmentKind },
  destinationId: string,
  followEventId: string | null,
) {
  return useQuery({
    queryKey: webhookDeliveriesKey(scope.organizationId, scope.projectId, scope.kind, destinationId),
    queryFn: () => webhookDeliveries.list(scope, destinationId),
    retry: false,
    refetchInterval: (query) => (shouldPollForTestEvent(followEventId, query.state.data ?? []) ? 3_000 : false),
  });
}
