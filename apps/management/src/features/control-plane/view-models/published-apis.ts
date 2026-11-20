import { useQuery } from "@tanstack/react-query";
import { publishedApis } from "../data/published-apis";
import type { EnvironmentKind } from "../model/control-plane";
import { useProjectEnvironment } from "./project-environment";
import { cpKeys } from "./query-keys";

/** Query keys for published APIs, nested under the control-plane keys so project invalidation reaches them. */
export const apiKeys = {
  list: (organizationId: string, projectId: string, kind: EnvironmentKind) => [...cpKeys.environment(organizationId, projectId, kind), "apis"] as const,
  accessRequests: (organizationId: string, projectId: string) => [...cpKeys.project(organizationId, projectId), "api-access-requests"] as const,
  catalog: (organizationId: string) => ["cp", organizationId, "api-catalog"] as const,
};

/** This environment's published APIs, active and disabled. */
export function useEnvironmentApis() {
  const { organizationId, project, kind } = useProjectEnvironment();
  return useQuery({ queryKey: apiKeys.list(organizationId, project.id, kind), queryFn: () => publishedApis.list(organizationId, project.id, kind) });
}
