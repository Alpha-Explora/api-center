import { z } from "zod";
import {
  applicationSchema,
  capabilitySchema,
  credentialSchema,
  grantSchema,
  issuedCredentialSchema,
  meSchema,
  memberSchema,
  planSchema,
  projectSchema,
  projectSummarySchema,
  readinessSchema,
  activationRequestSchema,
  teamSchema,
  usageSchema,
  type EnvironmentKind,
} from "../model/control-plane";

import { app, callPage, call, env, org, send } from "./http";

export const controlPlane = {
  me: (organizationId: string) => call(meSchema, `${org(organizationId)}/me`),
  capabilities: () => call(z.array(capabilitySchema), "capabilities"),
  plans: () => call(z.array(planSchema), "plans"),

  /** The first 200 projects, for pickers and navigation. The Projects page pages through all of them. */
  listProjects: (organizationId: string) => call(z.array(projectSummarySchema), `${org(organizationId)}/projects?limit=200`),
  projectsPage: (organizationId: string, cursor?: string) => callPage(projectSummarySchema, `${org(organizationId)}/projects?limit=100`, cursor),
  createProject: (organizationId: string, input: { slug: string; name: string }) =>
    call(projectSchema, `${org(organizationId)}/projects`, send("POST", input)),
  project: (organizationId: string, projectId: string) => call(projectSchema, `${org(organizationId)}/projects/${encodeURIComponent(projectId)}`),

  setCapability: (organizationId: string, projectId: string, kind: EnvironmentKind, capability: string, enabled: boolean) =>
    call(z.unknown(), `${env(organizationId, projectId, kind)}/capabilities/${encodeURIComponent(capability)}`, send("PUT", { enabled })),

  applications: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    call(z.array(applicationSchema), `${env(organizationId, projectId, kind)}/applications`),
  createApplication: (organizationId: string, projectId: string, kind: EnvironmentKind, input: { slug: string; name: string }) =>
    call(applicationSchema, `${env(organizationId, projectId, kind)}/applications`, send("POST", input)),

  grants: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
    call(z.array(grantSchema), `${app(organizationId, projectId, kind, applicationId)}/grants`),
  grant: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, input: { capability: string; action: string }) =>
    call(grantSchema, `${app(organizationId, projectId, kind, applicationId)}/grants`, send("POST", input)),
  revokeGrant: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, grantId: string) =>
    call(grantSchema, `${app(organizationId, projectId, kind, applicationId)}/grants/${encodeURIComponent(grantId)}/revoke`, send("POST", {})),

  credentials: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, cursor?: string) =>
    callPage(credentialSchema, `${app(organizationId, projectId, kind, applicationId)}/credentials?limit=100`, cursor),
  /** The operation ID makes a retried click safe: the gateway never issues twice for it. */
  issueCredential: (
    organizationId: string,
    projectId: string,
    kind: EnvironmentKind,
    applicationId: string,
    input: { operationId: string; expiresInDays?: number },
  ) => call(issuedCredentialSchema, `${app(organizationId, projectId, kind, applicationId)}/credentials`, send("POST", input)),
  revokeCredential: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, credentialId: string, reason: string) =>
    call(credentialSchema, `${app(organizationId, projectId, kind, applicationId)}/credentials/${encodeURIComponent(credentialId)}/revoke`, send("POST", { reason })),

  plan: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    call(z.object({ planKey: z.string() }).nullable(), `${env(organizationId, projectId, kind)}/plan`),
  assignPlan: (organizationId: string, projectId: string, kind: EnvironmentKind, planKey: string) =>
    call(z.unknown(), `${env(organizationId, projectId, kind)}/plan`, send("PUT", { planKey })),
  usage: (organizationId: string, projectId: string, kind: EnvironmentKind) => call(usageSchema, `${env(organizationId, projectId, kind)}/usage`),

  provisionLive: (organizationId: string, projectId: string) =>
    call(z.unknown(), `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live`, send("POST", {})),
  liveReadiness: (organizationId: string, projectId: string) =>
    call(readinessSchema, `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/readiness`),
  activationRequests: (organizationId: string, projectId: string) =>
    call(z.array(activationRequestSchema), `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/activation-requests`),
  requestActivation: (organizationId: string, projectId: string, reason: string) =>
    call(activationRequestSchema, `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/activation-requests`, send("POST", { reason })),
  decideActivation: (organizationId: string, projectId: string, approvalRequestId: string, decision: "approve" | "reject", reason?: string) =>
    call(
      activationRequestSchema,
      `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/activation-requests/${encodeURIComponent(approvalRequestId)}/${decision}`,
      send("POST", reason ? { reason } : {}),
    ),
  activateLive: (organizationId: string, projectId: string, approvalRequestId: string) =>
    call(z.unknown(), `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/activate`, send("POST", { approvalRequestId })),

  /** The first 200 members, for pickers. The People page pages through all of them. */
  members: (organizationId: string) => call(z.array(memberSchema), `${org(organizationId)}/members?limit=200`),
  membersPage: (organizationId: string, cursor?: string) => callPage(memberSchema, `${org(organizationId)}/members?limit=100`, cursor),
  setMember: (organizationId: string, email: string, role: string) =>
    call(z.unknown(), `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("PUT", { role })),
  removeMember: (organizationId: string, email: string) => call(z.unknown(), `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("DELETE")),
  teams: (organizationId: string) => call(z.array(teamSchema), `${org(organizationId)}/teams`),
  createTeam: (organizationId: string, input: { slug: string; name: string }) => call(teamSchema, `${org(organizationId)}/teams`, send("POST", input)),
  addTeamMember: (organizationId: string, teamId: string, email: string) =>
    call(z.unknown(), `${org(organizationId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(email)}`, send("PUT")),
};
