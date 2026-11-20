import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { projectRoleAssignmentSchema, type ProjectRoleInput } from "../model/project-roles";
import { call, env, project, send } from "./http";

export const testRecipientSchema = z.object({
  recipient: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type TestRecipient = z.infer<typeof testRecipientSchema>;

export const projectSettings = {
  roles: (organizationId: string, projectId: string) => call(z.array(projectRoleAssignmentSchema), `${project(organizationId, projectId)}/roles`),
  /** Upsert: assigning someone who already has a role changes it. 409 NOT_A_MEMBER for an email outside the organization. */
  setRole: (organizationId: string, projectId: string, input: ProjectRoleInput) =>
    call(projectRoleAssignmentSchema, `${project(organizationId, projectId)}/roles`, send("PUT", input)),
  removeRole: (organizationId: string, projectId: string, assignmentId: string) =>
    call(z.unknown(), `${project(organizationId, projectId)}/roles/${encodeURIComponent(assignmentId)}`, send("DELETE")),

  /** 409 LIVE_NOT_ACTIVATED while live is still provisioning. */
  setEnvironmentStatus: (organizationId: string, projectId: string, kind: EnvironmentKind, status: "active" | "suspended") =>
    call(z.unknown(), `${env(organizationId, projectId, kind)}/status`, send("PUT", { status })),

  /** Phone numbers and emails the test environment really delivers to. 400 for anything else, 409 for a duplicate. */
  testRecipients: (organizationId: string, projectId: string) =>
    call(z.array(testRecipientSchema), `${project(organizationId, projectId)}/test-recipients`),
  addTestRecipient: (organizationId: string, projectId: string, recipient: string) =>
    call(testRecipientSchema, `${project(organizationId, projectId)}/test-recipients`, send("POST", { recipient })),
  removeTestRecipient: (organizationId: string, projectId: string, recipient: string) =>
    call(z.unknown(), `${project(organizationId, projectId)}/test-recipients/${encodeURIComponent(recipient)}`, send("DELETE")),
};
