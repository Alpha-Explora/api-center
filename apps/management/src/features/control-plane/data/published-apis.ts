import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import {
  accessRequestSchema,
  apiGrantOutcomeSchema,
  catalogApiSchema,
  publishedApiSchema,
  type OperationBody,
} from "../model/published-apis";
import { app, call, env, org, project, send } from "./http";

export type PublishApiInput = { slug: string; name: string; upstreamUrl: string; operations: OperationBody[] };
/** `operations` replaces every operation of the API. */
export type UpdateApiInput = { status?: "active" | "disabled"; upstreamUrl?: string; operations?: OperationBody[] };

export const publishedApis = {
  list: (organizationId: string, projectId: string, kind: EnvironmentKind) =>
    call(z.array(publishedApiSchema), `${env(organizationId, projectId, kind)}/apis`),
  publish: (organizationId: string, projectId: string, kind: EnvironmentKind, input: PublishApiInput) =>
    call(publishedApiSchema, `${env(organizationId, projectId, kind)}/apis`, send("POST", input)),
  update: (organizationId: string, projectId: string, kind: EnvironmentKind, apiId: string, input: UpdateApiInput) =>
    call(publishedApiSchema, `${env(organizationId, projectId, kind)}/apis/${encodeURIComponent(apiId)}`, send("PUT", input)),

  /** Every active API in the organization, test and live, without upstream URLs. */
  catalog: (organizationId: string) => call(z.array(catalogApiSchema), `${org(organizationId)}/apis`),

  /** Requests from other projects for APIs this project owns, newest first. */
  accessRequests: (organizationId: string, projectId: string) =>
    call(z.array(accessRequestSchema), `${project(organizationId, projectId)}/api-access-requests`),
  decide: (organizationId: string, requestId: string, approve: boolean) =>
    call(accessRequestSchema, `${org(organizationId)}/api-access-requests/${encodeURIComponent(requestId)}/decision`, send("POST", { approve })),

  /** Same project: granted now. Another project: a pending request (repeating it returns the same request). */
  requestAccess: (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string, input: { apiId: string; action: string }) =>
    call(apiGrantOutcomeSchema, `${app(organizationId, projectId, kind, applicationId)}/api-grants`, send("POST", input)),
};
