import { z } from "zod";
import { quotaPolicySchema, type QuotaPolicyBody, type SharedQuotaPolicyBody } from "../model/quotas";
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
};
