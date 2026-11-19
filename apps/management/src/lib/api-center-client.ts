// Browser-side calls to the console's own /api/local routes.
import { z } from "zod";
import { request } from "@/lib/api-center/client-core";

export { getApiCenterBaseUrl, setManagementSessionToken } from "@/lib/api-center/client-core";

const consoleRole = z.enum(["admin", "operator", "observer"]);

const managementSessionSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().optional(),
  role: consoleRole,
  source: z.enum(["local-dev", "google"]),
  organizationIds: z.array(z.string()),
  organizationRoles: z.record(z.string(), consoleRole),
  organizations: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })).default([]),
  platformAdmin: z.boolean(),
});

export type ManagementSession = z.infer<typeof managementSessionSchema>;

/** The signed-in person, their organizations and whether they are a platform operator. */
export async function getManagementSession(): Promise<ManagementSession> {
  const data = await request<unknown>("/api/local/session");
  return z.object({ success: z.boolean(), data: managementSessionSchema }).parse(data).data;
}
