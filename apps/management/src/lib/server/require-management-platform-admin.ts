import { requireManagementSession } from "./require-management-session";
import type { ManagementSession } from "./management-auth";

export async function requireManagementPlatformAdmin(
  request: Request,
): Promise<ManagementSession> {
  const session = await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });

  if (!session.platformAdmin) {
    throw new Error("Platform administrator access required");
  }

  return session;
}
