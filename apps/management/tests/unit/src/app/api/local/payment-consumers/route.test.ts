import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../src/app/api/local/payment-consumers/route";

const mocks = vi.hoisted(() => ({
  authorizeService: vi.fn().mockResolvedValue(undefined),
  requireManagementRouteAction: vi.fn().mockResolvedValue(undefined),
  registerPaymentConsumer: vi.fn().mockResolvedValue({ consumerServiceId: "billing-api" }),
  requireManagementService: vi.fn(async () => ({ registerPaymentConsumer: mocks.registerPaymentConsumer })),
}));

vi.mock("@/lib/server/organization-access", () => ({ authorizeService: mocks.authorizeService }));
vi.mock("@/lib/server/require-management-action", () => ({ requireManagementRouteAction: mocks.requireManagementRouteAction }));
vi.mock("@/app/api/local/payment-consumers/route-auth", () => ({
  requireManagementService: mocks.requireManagementService,
  managementError: (error: unknown) => Response.json({ success: false, error: { message: String(error) } }, { status: 500 }),
}));

describe("POST /api/local/payment-consumers", () => {
  afterEach(() => vi.clearAllMocks());

  it("passes the approval request ID through to consumer registration", async () => {
    const input = {
      consumerServiceId: "billing-api",
      environment: "live",
      approvalRequestId: "00000000-0000-4000-8000-000000000001",
    };
    const response = await POST(new Request("http://localhost/api/local/payment-consumers", {
      method: "POST",
      body: JSON.stringify(input),
    }));

    expect(response.status).toBe(201);
    expect(mocks.registerPaymentConsumer).toHaveBeenCalledWith(input);
  });
});
