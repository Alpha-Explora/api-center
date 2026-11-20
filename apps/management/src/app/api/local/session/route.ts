import { NextResponse } from "next/server";
import { authenticateConsoleRequest, isSameOriginRequest, requireManagementSession } from "@/lib/server/require-management-session";
import { sessionErrorResponse } from "@/lib/server/session-error-response";
import { clearedSessionCookie, isSecureConsole, issueSessionToken, sessionCookie, sessionKeyFrom } from "@/lib/server/console-session";
import { getManagementAuthConfig } from "@/lib/server/management-auth";

/** The signed-in person: from the session cookie, or a Google ID token from a tab that signed in before it. */
export async function GET(request: Request) {
  try {
    const { session } = await authenticateConsoleRequest(request);
    return NextResponse.json({ success: true, data: session });
  } catch (error) {
    return sessionErrorResponse(error);
  }
}

/**
 * Signs in: checks the Google ID token in the body and the account's APICenter access, then sets the
 * console session cookie (12 hours, HttpOnly).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbidden();
  const body = (await request.json().catch(() => undefined)) as { credential?: unknown } | undefined;
  const credential = typeof body?.credential === "string" ? body.credential.trim() : "";
  if (!credential) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in with Google to continue." } }, { status: 401 });
  }
  try {
    const session = await requireManagementSession({ authorizationHeader: `Bearer ${credential}` });
    if (getManagementAuthConfig().mode === "local-dev") return NextResponse.json({ success: true, data: session });
    const key = sessionKeyFrom(process.env.MANAGEMENT_SESSION_SIGNING_KEY);
    if (!key) {
      console.error("management session signing key is not configured (MANAGEMENT_SESSION_SIGNING_KEY)");
      return NextResponse.json(
        { success: false, error: { code: "SESSION_NOT_CONFIGURED", message: "Sign-in is not set up on this console yet." } },
        { status: 503 },
      );
    }
    const token = issueSessionToken(key, { subject: session.userId, email: session.email, name: session.name });
    const response = NextResponse.json({ success: true, data: session });
    response.headers.append("set-cookie", sessionCookie(token, isSecureConsole(request.url)));
    return response;
  } catch (error) {
    return sessionErrorResponse(error);
  }
}

/** Signs out of this browser. */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return forbidden();
  const response = NextResponse.json({ success: true });
  response.headers.append("set-cookie", clearedSessionCookie(isSecureConsole(request.url)));
  return response;
}

function forbidden() {
  return NextResponse.json({ success: false, error: { code: "FORBIDDEN_ORIGIN", message: "Request did not come from this console." } }, { status: 403 });
}
