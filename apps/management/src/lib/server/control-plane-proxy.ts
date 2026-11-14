import { apiCenterAdminRequest } from "./api-center-admin";
import { requireManagementSession } from "./require-management-session";

/** Path segments the console may address on the gateway's control-plane API. */
const SEGMENT = /^[A-Za-z0-9_.@-]{1,320}$/;
const ROOTS = new Set(["capabilities", "plans", "organizations"]);
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export type ControlPlaneProxyDependencies = {
  requireSession?: typeof requireManagementSession;
  forward?: typeof apiCenterAdminRequest;
};

/**
 * Forwards a console request to /api/v1/admin/control-plane/*. The gateway enforces every role:
 * this route only requires a signed-in session and passes the member's Google ID token as
 * X-APICenter-User-Token, so the gateway acts as that member rather than as the platform.
 */
export async function proxyControlPlane(
  request: Request,
  segments: string[],
  dependencies: ControlPlaneProxyDependencies = {},
): Promise<Response> {
  const requireSession = dependencies.requireSession ?? requireManagementSession;
  const forward = dependencies.forward ?? apiCenterAdminRequest;

  if (
    segments.length === 0 ||
    !ROOTS.has(segments[0]) ||
    segments.some((segment) => !SEGMENT.test(segment) || /^\.+$/.test(segment))
  ) {
    return Response.json({ success: false, error: "Unknown control-plane path" }, { status: 404 });
  }

  const authorization = request.headers.get("authorization");
  try {
    await requireSession({ authorizationHeader: authorization });
  } catch {
    return Response.json({ success: false, error: "Management authentication required" }, { status: 401 });
  }

  const userToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const search = new URL(request.url).search;
  const method = request.method.toUpperCase();
  const path = `/api/v1/admin/control-plane/${segments.map(encodeURIComponent).join("/")}${search}`;
  return forward(path, {
    method,
    ...(METHODS_WITH_BODY.has(method) ? { body: await request.text() } : {}),
    headers: userToken ? { "x-apicenter-user-token": userToken } : {},
    timeoutMs: 20_000,
  });
}
