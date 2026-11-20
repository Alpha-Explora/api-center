import type { EnvironmentKind } from "../model/control-plane";

/** React Query keys for control-plane data; scoped so invalidating a project refreshes everything under it. */
export const cpKeys = {
  session: ["management-session"] as const,
  catalog: ["cp", "capabilities"] as const,
  plans: ["cp", "plans"] as const,
  me: (organizationId: string) => ["cp", organizationId, "me"] as const,
  projects: (organizationId: string) => ["cp", organizationId, "projects"] as const,
  project: (organizationId: string, projectId: string) => ["cp", organizationId, "project", projectId] as const,
  environment: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    ["cp", organizationId, "project", projectId, kind] as const,
  applications: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    ["cp", organizationId, "project", projectId, kind, "applications"] as const,
  application: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
    ["cp", organizationId, "project", projectId, kind, "applications", applicationId] as const,
  plan: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    ["cp", organizationId, "project", projectId, kind, "plan"] as const,
  usage: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    ["cp", organizationId, "project", projectId, kind, "usage"] as const,
  liveReadiness: (organizationId: string, projectId: string) => ["cp", organizationId, "project", projectId, "live", "readiness"] as const,
  testRecipients: (organizationId: string, projectId: string) => ["cp", organizationId, "project", projectId, "test-recipients"] as const,
  activationRequests: (organizationId: string, projectId: string) =>
    ["cp", organizationId, "project", projectId, "live", "activation-requests"] as const,
  members: (organizationId: string) => ["cp", organizationId, "members"] as const,
  teams: (organizationId: string) => ["cp", organizationId, "teams"] as const,
  /** Platform operators: every organization. */
  organizations: ["cp", "organizations"] as const,
  /** Pending decisions; invalidate `approvalsRoot` after deciding anything. */
  approvalsRoot: ["cp", "approvals"] as const,
  approvals: (scope: "platform" | { organizationId: string }) =>
    ["cp", "approvals", scope === "platform" ? "platform" : scope.organizationId] as const,
};
