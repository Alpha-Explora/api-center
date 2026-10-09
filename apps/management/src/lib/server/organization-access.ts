import type { ManagementRole, ManagementSession } from "./management-auth";
import { apiCenterAdminJson } from "./api-center-admin";
import { requireManagementSession } from "./require-management-session";
import { managementRouteErrorResponse } from "./management-route-error";

const ROLE_RANK: Record<ManagementRole, number> = {
  observer: 1,
  operator: 2,
  admin: 3,
};

type GatewayEnvelope<T> = { success: true; data: T };

export async function managementOrganizationFilter(request: Request): Promise<string | undefined> {
  const session = await managementSession(request);
  if (session.platformAdmin) return undefined;
  const organizationIds = [...new Set(session.organizationIds)];
  if (organizationIds.length === 0) throw organizationAccessDenied();
  if (organizationIds.some((organizationId) => !session.organizationRoles[organizationId])) {
    throw organizationScopeUnresolved();
  }
  return organizationIds.join(",");
}

export async function requireOrganizationRole(
  request: Request,
  organizationId: string,
  minimumRole: ManagementRole,
): Promise<ManagementSession> {
  const session = await managementSession(request);
  requireSessionRole(session, organizationId, minimumRole);
  return session;
}

export async function requirePlatformAdministrator(request: Request): Promise<ManagementSession> {
  const session = await managementSession(request);
  if (!session.platformAdmin) throw new Error("Platform administrator required");
  return session;
}

export async function platformAdministratorResponse(request: Request): Promise<Response | null> {
  try {
    await requirePlatformAdministrator(request);
    return null;
  } catch (error) {
    return managementRouteErrorResponse(error, "Platform administrator access required.");
  }
}

export async function authorizeTribe(
  request: Request,
  tribeId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, () => tribeOrganizationId(tribeId));
}

export async function authorizeProject(
  request: Request,
  projectId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, () => projectOrganizationId(projectId));
}

export async function authorizeService(
  request: Request,
  serviceId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, async () => {
    const service = await gatewayData<Record<string, unknown>>(
      "/api/v1/registry/services/" + encodeURIComponent(serviceId),
    );
    return tribeOrganizationId(requiredString(service.ownerTribeId));
  });
}

export async function authorizeRegistrationRequest(
  request: Request,
  requestId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, async () => {
    const registrations = await gatewayData<Array<Record<string, unknown>>>(
      "/api/v1/registry/registration-requests",
    );
    const registration = registrations.find((item) => item.id === requestId);
    return tribeOrganizationId(requiredString(registration?.ownerTribeId));
  });
}

export async function authorizePlanAssignment(
  request: Request,
  assignmentId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, async () => {
    const assignments = await gatewayData<Array<Record<string, unknown>>>("/api/v1/plans/assignments");
    const assignment = assignments.find((item) => item.id === assignmentId);
    return projectOrganizationId(requiredString(assignment?.projectId));
  });
}

export async function authorizeQuotaPolicy(
  request: Request,
  policyId: string,
  minimumRole: ManagementRole = "observer",
): Promise<void> {
  await authorizeOwner(request, minimumRole, async () => {
    const policies = await gatewayData<Array<Record<string, unknown>>>("/api/v1/quotas/policies");
    const policy = policies.find((item) => item.id === policyId);
    return tribeOrganizationId(requiredString(policy?.ownerTribeId));
  });
}

// The session is checked before any ownership lookup, so a caller without a session cannot tell
// which resources exist. Platform admins act in every organization and skip the lookup.
async function authorizeOwner(
  request: Request,
  minimumRole: ManagementRole,
  resolveOrganizationId: () => Promise<string>,
): Promise<void> {
  const session = await managementSession(request);
  if (session.platformAdmin) return;
  requireSessionRole(session, await resolveOrganizationId(), minimumRole);
}

function requireSessionRole(
  session: ManagementSession,
  organizationId: string,
  minimumRole: ManagementRole,
): void {
  if (session.platformAdmin) return;
  if (!session.organizationIds.includes(organizationId)) throw organizationAccessDenied();
  const role = session.organizationRoles[organizationId];
  if (!role || ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw organizationAccessDenied();
  }
}

async function tribeOrganizationId(tribeId: string): Promise<string> {
  const tribe = await gatewayData<Record<string, unknown>>(
    "/api/v1/tenancy/tribes/" + encodeURIComponent(tribeId),
  );
  return requiredString(tribe.organizationId);
}

async function projectOrganizationId(projectId: string): Promise<string> {
  const project = await gatewayData<Record<string, unknown>>(
    "/api/v1/tenancy/projects/" + encodeURIComponent(projectId),
  );
  const tribe = project.tribe;
  if (!tribe || typeof tribe !== "object") throw organizationScopeUnresolved();
  return requiredString((tribe as Record<string, unknown>).organizationId);
}

async function managementSession(request: Request): Promise<ManagementSession> {
  return requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });
}

async function gatewayData<T>(path: string): Promise<T> {
  try {
    const result = await apiCenterAdminJson<GatewayEnvelope<T>>(path);
    if (!result || result.success !== true || !result.data) throw organizationScopeUnresolved();
    return result.data;
  } catch {
    throw organizationScopeUnresolved();
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw organizationScopeUnresolved();
  return value;
}

function organizationAccessDenied() {
  return new Error("Organization access denied");
}

function organizationScopeUnresolved() {
  return new Error("Organization scope could not be resolved");
}
