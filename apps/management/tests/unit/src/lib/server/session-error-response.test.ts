import { describe, expect, it, vi } from "vitest";
import { AccessCheckUnavailableError, NO_ORGANIZATION_ACCESS_MESSAGE } from "@/lib/server/management-auth";
import { sessionErrorResponse } from "@/lib/server/session-error-response";

describe("sessionErrorResponse", () => {
  it("answers 503 with Retry-After when the access check could not run, so the console retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = sessionErrorResponse(new AccessCheckUnavailableError("dana@acme.example", "aborted due to timeout"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    const body = await response.json();
    expect(body.error.code).toBe("ACCESS_CHECK_UNAVAILABLE");
    expect(body.error.message).not.toContain("aborted");
  });

  it("answers 403 for an account without a membership", async () => {
    const response = sessionErrorResponse(new Error(NO_ORGANIZATION_ACCESS_MESSAGE));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: "NO_ORGANIZATION_ACCESS", message: NO_ORGANIZATION_ACCESS_MESSAGE });
  });

  it("answers 401 only for a missing or rejected credential", async () => {
    const response = sessionErrorResponse(new Error("Token used too late"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
