"use client";
import { useQuery } from "@tanstack/react-query";
import { environmentInventory } from "../data/environment-inventory";
import type { EnvironmentKind } from "../model/control-plane";
import { cpKeys } from "./query-keys";

export const environmentCredentialsKey = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  [...cpKeys.environment(organizationId, projectId, kind), "credentials"] as const;
export const environmentGrantsKey = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  [...cpKeys.environment(organizationId, projectId, kind), "grants"] as const;

type Target = { organizationId: string | undefined; projectId: string; kind: EnvironmentKind; enabled?: boolean };

/** Active keys of every application in the environment; shared by the overview and the sidebar. */
export function useEnvironmentCredentials({ organizationId, projectId, kind, enabled = true }: Target) {
  return useQuery({
    queryKey: environmentCredentialsKey(organizationId ?? "none", projectId, kind),
    queryFn: () => environmentInventory.credentials({ organizationId: organizationId as string, projectId, kind }),
    enabled: enabled && Boolean(organizationId),
  });
}

export function useEnvironmentGrants({ organizationId, projectId, kind, enabled = true }: Target) {
  return useQuery({
    queryKey: environmentGrantsKey(organizationId ?? "none", projectId, kind),
    queryFn: () => environmentInventory.grants({ organizationId: organizationId as string, projectId, kind }),
    enabled: enabled && Boolean(organizationId),
    // Grants change on application pages; the checklist should not lag behind them.
    staleTime: 0,
  });
}
