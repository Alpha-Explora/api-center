import { z as zod, type z } from "zod";
import { request } from "@/lib/api-center/client-core";
import type { EnvironmentKind } from "../model/control-plane";

const BASE = "/api/local/control-plane";

/** Calls the console's control-plane proxy and parses the gateway's `data` with the given schema. */
export async function call<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const response = await request<{ data: unknown }>(`${BASE}/${path}`, init);
  return schema.parse(response.data);
}

/** Like `call` for a paged list: the page's items, parsed with `item`, and the cursor for the next page (null at the end). */
export async function callPage<T>(item: z.ZodType<T>, path: string, cursor?: string): Promise<{ items: T[]; nextCursor: string | null }> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await request<{ data: unknown; meta?: { nextCursor?: string | null } }>(
    `${BASE}/${path}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  return { items: zod.array(item).parse(response.data), nextCursor: response.meta?.nextCursor ?? null };
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
