import { z } from "zod";
import { memberChangeSchema } from "../model/organizations";
import { call, org, send } from "./http";

/** Adds a member or changes their role; a new member's `invite` says whether the invite email went out. */
export const members = {
  /** `projects` gives project roles in the same step; a new member's invite email lists them. */
  set: (organizationId: string, email: string, role: string, projects?: { projectId: string; role: "admin" | "developer" | "viewer" }[]) =>
    call(memberChangeSchema, `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("PUT", { role, ...(projects?.length ? { projects } : {}) })),
  /** Renews an unaccepted invite for 7 days and emails it again. 409 INVITE_ALREADY_ACCEPTED once they have signed in. */
  resendInvite: (organizationId: string, email: string) =>
    call(memberChangeSchema, `${org(organizationId)}/members/${encodeURIComponent(email)}/invite`, send("POST")),
  /** Suspends or restores an accepted member. 409 LAST_OWNER or LAST_PROJECT_ADMIN when that would leave no one in charge. */
  setStatus: (organizationId: string, email: string, status: "active" | "suspended") =>
    call(z.unknown(), `${org(organizationId)}/members/${encodeURIComponent(email)}/status`, send("PUT", { status })),
};
