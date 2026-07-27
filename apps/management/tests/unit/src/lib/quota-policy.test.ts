import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disableQuotaPolicy,
  getQuotaUsage,
  listQuotaPolicies,
  saveQuotaPolicy,
} from "../../../../src/lib/api-center-client";
import {
  quotaPolicyListResponseSchema,
  quotaPolicySchema,
  quotaUsageResponseSchema,
} from "../../../../src/lib/schemas";
import { quotaPolicyInputSchema } from "../../../../src/lib/quota-policy";

describe("quota policy schemas and client helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses quota policy list responses from API Center", () => {
    const parsed = quotaPolicyListResponseSchema.parse({
      success: true,
      data: [
        {
          id: "policy-1",
          ownerTribeId: "campus-one",
          scope: "shared",
          targetServiceId: "payment-service",
          windowSeconds: 60,
          maxRequests: 100,
          burstRequests: null,
          mode: "observe",
          status: "active",
          reason: "initial observe rollout",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      ],
      meta: { total: 1 },
    });

    expect(parsed.data[0]).toEqual(
      expect.objectContaining({
        ownerTribeId: "campus-one",
        scope: "shared",
        mode: "observe",
      }),
    );
  });

  it("rejects invalid quota policy input before save", () => {
    expect(() =>
      quotaPolicyInputSchema.parse({
        ownerTribeId: "campus-one",
        scope: "shared",
        windowSeconds: 0,
        maxRequests: 0,
        reason: "",
      }),
    ).toThrow();
  });

  it("defaults new quota policies to observe mode", () => {
    const input = quotaPolicyInputSchema.parse({
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
      windowSeconds: 60,
      maxRequests: 100,
      reason: "initial observe rollout",
    });

    expect(input.mode).toBe("observe");
  });

  it("parses quota usage decision responses", () => {
    const parsed = quotaUsageResponseSchema.parse({
      success: true,
      data: [
        {
          id: "decision-1",
          ownerTribeId: "campus-one",
          policyId: "policy-1",
          scope: "shared",
          targetServiceId: "payment-service",
          routeFamily: "shared:payment-service",
          windowStart: "2026-05-25T00:00:00.000Z",
          windowEnd: "2026-05-25T00:01:00.000Z",
          requestCount: 101,
          maxRequests: 100,
          mode: "observe",
          outcome: "observed_exceeded",
          correlationId: "corr-1",
          createdAt: "2026-05-25T00:00:30.000Z",
        },
      ],
      meta: { window: "24h" },
    });

    expect(parsed.data[0].outcome).toBe("observed_exceeded");
  });

  it("uses local quota policy routes from the browser client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            quotaPolicySchema.parse({
              id: "policy-1",
              ownerTribeId: "campus-one",
              scope: "shared",
              targetServiceId: "payment-service",
              windowSeconds: 60,
              maxRequests: 100,
              burstRequests: null,
              mode: "observe",
              status: "active",
              reason: "initial observe rollout",
              updatedAt: "2026-05-25T00:00:00.000Z",
            }),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listQuotaPolicies("campus-one");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/quotas/policies?ownerTribeId=campus-one",
      expect.any(Object),
    );
  });

  it("saves and disables quota policies through local routes", async () => {
    const policy = {
      id: "policy-1",
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
      windowSeconds: 60,
      maxRequests: 100,
      burstRequests: null,
      mode: "observe",
      status: "active",
      reason: "initial observe rollout",
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: policy }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { ...policy, status: "disabled" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await saveQuotaPolicy({
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
      windowSeconds: 60,
      maxRequests: 100,
      reason: "initial observe rollout",
    });
    await disableQuotaPolicy("policy-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/local/quotas/policies");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/local/quotas/policies/policy-1",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("reads quota usage through the local route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getQuotaUsage({ ownerTribeId: "campus-one", window: "7d" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/local/quotas/usage?ownerTribeId=campus-one&window=7d",
    );
  });
});
