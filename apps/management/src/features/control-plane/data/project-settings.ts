import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { projectRoleAssignmentSchema, type ProjectRoleInput } from "../model/project-roles";
import { call, env, project, send } from "./http";

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
};
