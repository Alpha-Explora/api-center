import { NextResponse } from "next/server";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { sessionErrorResponse } from "@/lib/server/session-error-response";

export async function GET(request: Request) {
  try {
    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });

    return NextResponse.json({
      success: true,
      data: session,
    });
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
