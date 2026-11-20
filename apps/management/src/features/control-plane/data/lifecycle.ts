import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { call, env, org, project, send } from "./http";

/** Suspending, archiving and deleting. Nothing here removes keys or settings except deleting a team. */
export const lifecycle = {
  /** A suspended application's keys and workload identities are refused with APPLICATION_INACTIVE. */
  setApplicationStatus: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, status: "active" | "suspended") =>
    call(z.unknown(), `${env(organizationId, projectId, kind)}/applications/${encodeURIComponent(applicationId)}/status`, send("PUT", { status })),
  /** An archived project refuses every request with PROJECT_INACTIVE; 403 SUSPENDED_BY_PLATFORM if an operator suspended it. */
  setProjectStatus: (organizationId: string, projectId: string, status: "active" | "archived") =>
    call(z.unknown(), `${project(organizationId, projectId)}/status`, send("PUT", { status })),
  /** 409 LAST_PROJECT_ADMIN when the team is a project's only administrator. */
  deleteTeam: (organizationId: string, teamId: string) =>
    call(z.unknown(), `${org(organizationId)}/teams/${encodeURIComponent(teamId)}`, send("DELETE")),
};
