import type { EnvironmentKind } from "../model/control-plane";
import { cpKeys } from "./query-keys";

/** Query key for one capability's settings in one environment, nested so environment invalidation refreshes it. */
export const configurationKey = (organizationId: string, projectId: string, kind: EnvironmentKind, capability: string) =>
  [...cpKeys.environment(organizationId, projectId, kind), "configuration", capability] as const;
