import { z } from "zod";
import { approvalItemSchema } from "../model/approvals";
import { call, org } from "./http";

export type ApprovalsState = "pending" | "decided";

const query = (state: ApprovalsState) => (state === "decided" ? "?state=decided" : "");

export const approvals = {
  /** Every organization's pending (or recently decided) items; platform operators only. */
  all: (state: ApprovalsState = "pending") => call(z.array(approvalItemSchema), `approvals${query(state)}`),
  /** This organization's items the signed-in person may decide: pending, or decided in the last 30 days. */
  forOrganization: (organizationId: string, state: ApprovalsState = "pending") =>
    call(z.array(approvalItemSchema), `${org(organizationId)}/approvals${query(state)}`),
};
