import { z } from "zod";
import { request } from "@/lib/api-center/client-core";
import {
  applicationSchema,
  assignmentSchema,
  capabilitySchema,
  credentialSchema,
  grantSchema,
  inventorySchema,
  issuedCredentialSchema,
  meSchema,
  memberSchema,
  mismatchSchema,
  planSchema,
  projectSchema,
  projectSummarySchema,
  readinessSchema,
  teamSchema,
  usageSchema,
  type EnvironmentKind,
} from "../model/control-plane";

const BASE = "/api/local/control-plane";

async function call<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const response = await request<{ data: unknown }>(`${BASE}/${path}`, init);
  return schema.parse(response.data);
}

function send(method: "POST" | "PUT" | "DELETE", body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

const org = (organizationId: string) => `organizations/${encodeURIComponent(organizationId)}`;
const env = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/${kind}`;
const app = (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
  `${env(organizationId, projectId, kind)}/applications/${encodeURIComponent(applicationId)}`;

export const controlPlane = {
  me: (organizationId: string) => call(meSchema, `${org(organizationId)}/me`),
  capabilities: () => call(z.array(capabilitySchema), "capabilities"),
  plans: () => call(z.array(planSchema), "plans"),

  listProjects: (organizationId: string) => call(z.array(projectSummarySchema), `${org(organizationId)}/projects`),
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

  credentials: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
    call(z.array(credentialSchema), `${app(organizationId, projectId, kind, applicationId)}/credentials`),
  /** The operation ID makes a retried click safe: the gateway never issues twice for it. */
  issueCredential: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, operationId: string) =>
    call(issuedCredentialSchema, `${app(organizationId, projectId, kind, applicationId)}/credentials`, send("POST", { operationId })),
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
  activateLive: (organizationId: string, projectId: string, approvalRequestId: string) =>
    call(z.unknown(), `${org(organizationId)}/projects/${encodeURIComponent(projectId)}/environments/live/activate`, send("POST", { approvalRequestId })),

  members: (organizationId: string) => call(z.array(memberSchema), `${org(organizationId)}/members`),
  setMember: (organizationId: string, email: string, role: string) =>
    call(z.unknown(), `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("PUT", { role })),
  removeMember: (organizationId: string, email: string) => call(z.unknown(), `${org(organizationId)}/members/${encodeURIComponent(email)}`, send("DELETE")),
  teams: (organizationId: string) => call(z.array(teamSchema), `${org(organizationId)}/teams`),
  createTeam: (organizationId: string, input: { slug: string; name: string }) => call(teamSchema, `${org(organizationId)}/teams`, send("POST", input)),
  addTeamMember: (organizationId: string, teamId: string, email: string) =>
    call(z.unknown(), `${org(organizationId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(email)}`, send("PUT")),

  inventory: (organizationId: string) => call(inventorySchema, `${org(organizationId)}/migration/inventory`),
  backfill: (organizationId: string, revision: string) => call(z.unknown(), `${org(organizationId)}/migration/backfill`, send("POST", { revision })),
  assignments: (organizationId: string) => call(z.array(assignmentSchema), `${org(organizationId)}/migration/assignments`),
  mismatches: (organizationId: string) => call(z.array(mismatchSchema), `${org(organizationId)}/migration/shadow-mismatches`),
  cutover: (organizationId: string, projectId: string, kind: EnvironmentKind, expectedFence: number) =>
    call(assignmentSchema, `${org(organizationId)}/migration/projects/${encodeURIComponent(projectId)}/environments/${kind}/cutover`, send("POST", { expectedFence })),
  rollback: (organizationId: string, projectId: string, kind: EnvironmentKind, expectedFence: number) =>
    call(assignmentSchema, `${org(organizationId)}/migration/projects/${encodeURIComponent(projectId)}/environments/${kind}/rollback`, send("POST", { expectedFence })),
};
