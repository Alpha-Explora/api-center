import { auditPageSchema } from "../model/observability";
import { call } from "./http";

/** Every organization's audit events, and platform events without one. Platform operators only. */
export const platformAudit = {
  /** `search` comes from `auditSearch`; a project filter is ignored across organizations. */
  events: (search: string) => call(auditPageSchema, `audit-events?${search}`),
};
