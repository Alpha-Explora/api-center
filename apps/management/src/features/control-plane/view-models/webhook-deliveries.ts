"use client";
import { useQuery } from "@tanstack/react-query";
import { webhookDeliveries } from "../data/webhook-deliveries";
import type { EnvironmentKind } from "../model/control-plane";
import { cpKeys } from "./query-keys";

export const webhookDeliveriesKey = (organizationId: string, projectId: string, kind: EnvironmentKind, destinationId: string) =>
  [...cpKeys.environment(organizationId, projectId, kind), "event-destinations", destinationId, "deliveries"] as const;

/** A webhook's recent attempts. Polls every few seconds while `polling` is set (a test event is in flight). */
export function useWebhookDeliveries(scope: { organizationId: string; projectId: string; kind: EnvironmentKind }, destinationId: string, polling: boolean) {
  return useQuery({
    queryKey: webhookDeliveriesKey(scope.organizationId, scope.projectId, scope.kind, destinationId),
    queryFn: () => webhookDeliveries.list(scope, destinationId),
    retry: false,
    refetchInterval: polling ? 3_000 : false,
  });
}
