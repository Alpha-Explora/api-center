import type { ManagementSession } from "./management-auth";
import { authenticateConsoleRequest } from "./require-management-session";

/** The signed-in platform operator, or an error for anyone else. */
export async function requirePlatformAdministrator(request: Request): Promise<ManagementSession> {
  const { session } = await authenticateConsoleRequest(request);
  if (!session.platformAdmin) throw new Error("Platform administrator required");
  return session;
}
