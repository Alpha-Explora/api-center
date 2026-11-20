import { z } from "zod";
import { createdOrganizationSchema, organizationSchema, organizationSummarySchema } from "../model/organizations";
import { call, org, send } from "./http";

/** Platform-operator routes: every organization, and creating, renaming and suspending them. */
export const organizationsAdmin = {
  list: () => call(z.array(organizationSummarySchema), "organizations"),
  create: (input: { name: string; slug: string; ownerEmail?: string }) => call(createdOrganizationSchema, "organizations", send("POST", input)),
  rename: (organizationId: string, input: { name: string; slug: string }) => call(organizationSchema, org(organizationId), send("PUT", input)),
  /** Renames an organization, keeping its slug; its owners may do this as well as platform operators. */
  renameName: (organizationId: string, name: string) => call(organizationSchema, org(organizationId), send("PUT", { name })),
  setStatus: (organizationId: string, status: "active" | "suspended") => call(organizationSchema, `${org(organizationId)}/status`, send("PUT", { status })),
};
