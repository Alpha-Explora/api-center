import { apiCenterAdminRequest } from "./api-center-admin";
import { authenticateConsoleRequest, isSameOriginRequest } from "./require-management-session";
import { sessionErrorResponse } from "./session-error-response";

/** Path segments the console may address on the gateway's control-plane API. */
const SEGMENT = /^[A-Za-z0-9_.@+-]{1,320}$/;
const ROOTS = new Set(["capabilities", "plans", "organizations", "approvals"]);
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);
/** Platform-wide routes; the gateway refuses them unless the caller is a platform operator. */
const PLATFORM_ROOTS = new Set(["audit-events"]);

export type ControlPlaneProxyDependencies = {
  authenticate?: (request: Request) => ReturnType<typeof authenticateConsoleRequest>;
  forward?: typeof apiCenterAdminRequest;
};

/**
 * Forwards a console request to /api/v1/admin/control-plane/*. The gateway enforces every role:
 * this route only requires a signed-in session and passes who the person is (the console session as
 * X-APICenter-User-Session, or a Google ID token as X-APICenter-User-Token), so the gateway acts as that
 * member rather than as the platform.
 */
export async function proxyControlPlane(
  request: Request,
  segments: string[],
  dependencies: ControlPlaneProxyDependencies = {},
): Promise<Response> {
  const authenticate = dependencies.authenticate ?? ((incoming: Request) => authenticateConsoleRequest(incoming));
  const forward = dependencies.forward ?? apiCenterAdminRequest;

  if (
    segments.length === 0 ||
    !(ROOTS.has(segments[0]) || PLATFORM_ROOTS.has(segments[0])) ||
    segments.some((segment) => !SEGMENT.test(segment) || /^\.+$/.test(segment))
  ) {
    return Response.json({ success: false, error: "Unknown control-plane path" }, { status: 404 });
  }

  if (!isSameOriginRequest(request)) {
    return Response.json({ success: false, error: { code: "FORBIDDEN_ORIGIN", message: "Request did not come from this console." } }, { status: 403 });
  }
  let gatewayHeaders: Record<string, string>;
  try {
    gatewayHeaders = (await authenticate(request)).gatewayHeaders;
  } catch (error) {
    return sessionErrorResponse(error);
  }

  const search = new URL(request.url).search;
  const method = request.method.toUpperCase();
  const path = `/api/v1/admin/control-plane/${segments.map(encodeURIComponent).join("/")}${search}`;
  return forward(path, {
    method,
    ...(METHODS_WITH_BODY.has(method) ? { body: await request.text() } : {}),
    headers: gatewayHeaders,
    timeoutMs: 20_000,
  });
}
