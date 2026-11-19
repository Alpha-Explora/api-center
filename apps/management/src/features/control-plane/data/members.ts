import { memberChangeSchema } from "../model/organizations";
import { call, org, send } from "./http";

/** Adds a member or changes their role; a new member's `invite` says whether the invite email went out. */
export const members = {
  set: (organizationId: string, email: string, role: string) =>
    call(memberChangeSchema, `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("PUT", { role })),
};
