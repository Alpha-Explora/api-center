import { NextResponse } from "next/server";

export function managementRouteErrorResponse(
  error: unknown,
  fallback: string,
) {
  const message = error instanceof Error ? error.message : fallback;

  if (
    message === "Management authentication required" ||
    message === "Management authentication issuer mismatch"
  ) {
    return NextResponse.json(
      { success: false, error: message },
      { status: 401 },
    );
  }

  if (
    message.includes("observer cannot perform") ||
    message.includes("live write actions require admin role") ||
    message === "Platform administrator access required"
  ) {
    return NextResponse.json(
      { success: false, error: message },
      { status: 403 },
    );
  }

  if (
    message.includes("Type APPLY LIVE CHANGE") ||
    message.includes("reason is required")
  ) {
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { success: false, error: message },
    { status: 500 },
  );
}
