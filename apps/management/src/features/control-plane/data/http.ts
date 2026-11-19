import type { z } from "zod";
import { request } from "@/lib/api-center/client-core";
import type { EnvironmentKind } from "../model/control-plane";

const BASE = "/api/local/control-plane";

/** Calls the console's control-plane proxy and parses the gateway's `data` with the given schema. */
export async function call<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const response = await request<{ data: unknown }>(`${BASE}/${path}`, init);
  return schema.parse(response.data);
}

export function send(method: "POST" | "PUT" | "DELETE", body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export const org = (organizationId: string) => `organizations/${encodeURIComponent(organizationId)}`;
export const project = (organizationId: string, projectId: string) =>
  `${org(organizationId)}/projects/${encodeURIComponent(projectId)}`;
export const env = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  `${project(organizationId, projectId)}/environments/${kind}`;
export const app = (organizationId: string, projectId: string, kind: EnvironmentKind, applicationId: string) =>
  `${env(organizationId, projectId, kind)}/applications/${encodeURIComponent(applicationId)}`;
