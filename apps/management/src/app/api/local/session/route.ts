import { NextResponse } from "next/server";
import { requireManagementSession } from "@/lib/server/require-management-session";

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
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Management authentication required",
      },
      { status: 401 },
    );
  }
}
