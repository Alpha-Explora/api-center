import { z } from "zod";
import { quotaPolicySchema, type QuotaPolicyBody, type SharedQuotaPolicyBody } from "../model/quotas";
import type { QuotaPolicyChange } from "../model/quota-edit";
import { call, org, project, send } from "./http";

export const quotas = {
  /** The project's own policies plus the shared ceilings that cover it, for both environments. */
  projectPolicies: (organizationId: string, projectId: string) => call(z.array(quotaPolicySchema), `${project(organizationId, projectId)}/quota-policies`),
  createProjectPolicy: (organizationId: string, projectId: string, body: QuotaPolicyBody) =>
    call(quotaPolicySchema, `${project(organizationId, projectId)}/quota-policies`, send("POST", body)),
  /** Every policy in the organization; organization owners and admins only. */
  organizationPolicies: (organizationId: string) => call(z.array(quotaPolicySchema), `${org(organizationId)}/quota-policies`),
  createSharedPolicy: (organizationId: string, body: SharedQuotaPolicyBody) =>
    call(quotaPolicySchema, `${org(organizationId)}/quota-policies`, send("POST", body)),
  setStatus: (organizationId: string, policyId: string, status: "active" | "disabled") =>
    call(quotaPolicySchema, `${org(organizationId)}/quota-policies/${encodeURIComponent(policyId)}/status`, send("PUT", { status })),
  /** Only the changed fields; the audit trail records them before and after. */
  update: (organizationId: string, policyId: string, change: QuotaPolicyChange) =>
    call(quotaPolicySchema, `${org(organizationId)}/quota-policies/${encodeURIComponent(policyId)}`, send("PUT", change)),
  /** A soft delete: the policy stops applying and leaves every list; its audit trail stays. */
  remove: (organizationId: string, policyId: string) =>
    call(z.object({ id: z.string(), deleted: z.literal(true) }), `${org(organizationId)}/quota-policies/${encodeURIComponent(policyId)}`, send("DELETE")),
};
