import type { EnvironmentKind } from "../model/control-plane";
import {
  auditPageSchema,
  quotaMetersSchema,
  requestLogPageSchema,
  sharedCeilingMetersSchema,
  usageSeriesSchema,
  type UsageRange,
} from "../model/observability";
import { call, env, org } from "./http";

export const observability = {
  /** One page of the environment's request log; `search` comes from `requestLogSearch`. */
  requests: (organizationId: string, projectId: string, kind: EnvironmentKind, search: string) =>
    call(requestLogPageSchema, `${env(organizationId, projectId, kind)}/requests?${search}`),
  usageSeries: (organizationId: string, projectId: string, kind: EnvironmentKind, range: UsageRange) =>
    call(usageSeriesSchema, `${env(organizationId, projectId, kind)}/usage/series?range=${range}`),
  quotaUsage: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    call(quotaMetersSchema, `${env(organizationId, projectId, kind)}/quota-usage`),
  /** Shared ceilings' current windows; organization owners and admins only. */
  sharedQuotaUsage: (organizationId: string) => call(sharedCeilingMetersSchema, `${org(organizationId)}/quota-usage`),
  /** One page of the organization's audit log; `search` comes from `auditSearch`. */
  auditEvents: (organizationId: string, search: string) => call(auditPageSchema, `${org(organizationId)}/audit-events?${search}`),
};
