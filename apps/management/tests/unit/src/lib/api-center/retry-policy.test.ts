import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-center/client-core";
import { MAX_RETRIES, isTransientError, retryDelay, shouldRetryQuery } from "@/lib/api-center/retry-policy";

describe("console retry policy", () => {
  it("retries only failures that may clear by themselves", () => {
    for (const status of [0, 408, 429, 500, 502, 503, 504]) {
      expect(isTransientError(new ApiError("x", status))).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientError(new ApiError("x", status))).toBe(false);
    }
    expect(isTransientError(new Error("schema mismatch"))).toBe(false);
  });

  it("stops after a few attempts", () => {
    const busy = new ApiError("busy", 503, "DATABASE_BUSY");
    expect(shouldRetryQuery(0, busy)).toBe(true);
    expect(shouldRetryQuery(MAX_RETRIES - 1, busy)).toBe(true);
    expect(shouldRetryQuery(MAX_RETRIES, busy)).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("missing", 404))).toBe(false);
  });

  it("waits as long as Retry-After asks, otherwise backs off with jitter", () => {
    expect(retryDelay(0, new ApiError("busy", 503, "DATABASE_BUSY", 2))).toBe(2000);
    expect(retryDelay(0, new ApiError("busy", 503, "DATABASE_BUSY", 120))).toBe(8000);
    expect(retryDelay(0, new ApiError("busy", 503), () => 0)).toBe(500);
    expect(retryDelay(2, new ApiError("busy", 503), () => 1)).toBe(4000);
    expect(retryDelay(10, new ApiError("busy", 503), () => 1)).toBe(8000);
  });
});
