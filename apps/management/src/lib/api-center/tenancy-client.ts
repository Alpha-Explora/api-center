import {
  createProjectInputSchema,
  createTribeInputSchema,
  tenancyProjectResponseSchema,
  tenancyTribeListResponseSchema,
  tenancyTribeResponseSchema,
  updateTenancyStatusInputSchema,
  type CreateProjectInput,
  type CreateTribeInput,
  type TenancyProject,
  type TenancyStatus,
  type TenancyTribe,
} from "@/lib/schemas";
import { request } from "@/lib/api-center/client-core";

/** Live management writes need a typed phrase and a reason; the local route strips this before forwarding. */
export type TenancyWriteConfirmation = { typedPhrase?: string; reason?: string };

function withConfirmation<T extends object>(
  payload: T,
  confirmation?: TenancyWriteConfirmation,
) {
  return JSON.stringify(confirmation ? { ...payload, confirmation } : payload);
}

export async function listTribes(): Promise<TenancyTribe[]> {
  const data = await request<unknown>("/api/local/tenancy/tribes");
  return tenancyTribeListResponseSchema.parse(data).data;
}

/** Every project across tribes, flattened; used to pick a project for a service. */
export async function listProjects(): Promise<TenancyProject[]> {
  return (await listTribes()).flatMap((tribe) => tribe.projects);
}

export async function createTribe(
  input: CreateTribeInput,
  confirmation?: TenancyWriteConfirmation,
): Promise<TenancyTribe> {
  const payload = createTribeInputSchema.parse(input);
  const data = await request<unknown>("/api/local/tenancy/tribes", {
    method: "POST",
    body: withConfirmation(payload, confirmation),
  });
  return tenancyTribeResponseSchema.parse(data).data;
}

export async function createProject(
  tribeId: string,
  input: CreateProjectInput,
  confirmation?: TenancyWriteConfirmation,
): Promise<TenancyProject> {
  const payload = createProjectInputSchema.parse(input);
  const data = await request<unknown>(
    `/api/local/tenancy/tribes/${encodeURIComponent(tribeId)}/projects`,
    { method: "POST", body: withConfirmation(payload, confirmation) },
  );
  return tenancyProjectResponseSchema.parse(data).data;
}

export async function setTribeStatus(tribeId: string, status: TenancyStatus): Promise<TenancyTribe> {
  const payload = updateTenancyStatusInputSchema.parse({ status });
  const data = await request<unknown>(
    `/api/local/tenancy/tribes/${encodeURIComponent(tribeId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  return tenancyTribeResponseSchema.parse(data).data;
}

export async function setProjectStatus(
  projectId: string,
  status: TenancyStatus,
): Promise<TenancyProject> {
  const payload = updateTenancyStatusInputSchema.parse({ status });
  const data = await request<unknown>(
    `/api/local/tenancy/projects/${encodeURIComponent(projectId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  return tenancyProjectResponseSchema.parse(data).data;
}
