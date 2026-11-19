"use client";
import { useQuery } from "@tanstack/react-query";
import { eventDestinations } from "../data/event-destinations";
import type { EnvironmentKind } from "../model/control-plane";
import { useProjectEnvironment } from "./project-environment";
import { cpKeys } from "./query-keys";

export const eventDestinationsKey = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  [...cpKeys.environment(organizationId, projectId, kind), "event-destinations"] as const;

/** The current environment's event destinations, shared by the Webhooks page and the application tab. */
export function useEventDestinations() {
  const { organizationId, project, kind } = useProjectEnvironment();
  return useQuery({
    queryKey: eventDestinationsKey(organizationId, project.id, kind),
    queryFn: () => eventDestinations.list({ organizationId, projectId: project.id, kind }),
    retry: false,
  });
}

/** Whether payments is enabled here; the gateway refuses destinations otherwise (CAPABILITY_NOT_ENABLED). */
export function usePaymentsEnabled() {
  const { environment } = useProjectEnvironment();
  return Boolean(environment?.capabilities.some((entry) => entry.capability === "payments" && entry.status === "enabled"));
}
