import { AccessCheckUnavailableError, NO_ORGANIZATION_ACCESS_MESSAGE } from "./management-auth";

/**
 * The response for a session that could not be established. Only a missing or rejected credential
 * is 401: a failed membership lookup is 503, so the console retries instead of signing people out,
 * and an account without a membership is 403.
 */
export function sessionErrorResponse(error: unknown): Response {
  if (error instanceof AccessCheckUnavailableError) {
    console.error("management access check unavailable", { reason: error.reason });
    return Response.json(
      { success: false, error: { code: error.code, message: error.message } },
      { status: 503, headers: { "retry-after": "2" } },
    );
  }
  const message = error instanceof Error ? error.message : "";
  if (message === NO_ORGANIZATION_ACCESS_MESSAGE) {
    return Response.json({ success: false, error: { code: "NO_ORGANIZATION_ACCESS", message } }, { status: 403 });
  }
  return Response.json(
    { success: false, error: { code: "UNAUTHENTICATED", message: "Your sign-in has expired or is not valid. Sign in again." } },
    { status: 401 },
  );
}
