import { z } from "zod";
import { approvalItemSchema } from "../model/approvals";
import { call, org } from "./http";

export const approvals = {
  /** Every organization's pending items; platform operators only. */
  all: () => call(z.array(approvalItemSchema), "approvals"),
  /** This organization's pending items that the signed-in person may decide. */
  forOrganization: (organizationId: string) => call(z.array(approvalItemSchema), `${org(organizationId)}/approvals`),
};
