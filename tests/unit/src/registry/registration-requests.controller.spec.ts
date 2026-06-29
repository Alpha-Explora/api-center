import { AuditEventsService } from "../../../../src/analytics/audit-events.service";
import { RegistrationRequestsController } from "../../../../src/registry/registration-requests.controller";
import { RegistrationRequestsService } from "../../../../src/registry/registration-requests.service";

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    serviceId: "orders",
    ownerTribeId: "commerce",
    status: "applied",
    manifest: {
      serviceId: "orders",
      ownerTribeId: "commerce",
      name: "Orders",
      baseUrl: "https://orders.example.test",
      requiredScopes: ["orders:read"],
      exposes: ["/orders"],
      consumes: [],
    },
    validationReport: { canApply: true, issues: [] },
    requestedBy: "github:commerce/orders",
    approvedBy: "operator-1",
    rejectedBy: null,
    rejectionReason: null,
    appliedServiceId: "orders",
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    decidedAt: "2026-06-25T00:05:00.000Z",
    appliedAt: "2026-06-25T00:05:00.000Z",
    ...overrides,
  };
}

describe("RegistrationRequestsController", () => {
  let requests: {
    approveRequest: jest.Mock;
    rejectRequest: jest.Mock;
    createRequest: jest.Mock;
    listRequests: jest.Mock;
  };
  let auditEvents: { recordRequired: jest.Mock };
  let controller: RegistrationRequestsController;

  beforeEach(() => {
    requests = {
      approveRequest: jest.fn(),
      rejectRequest: jest.fn(),
      createRequest: jest.fn(),
      listRequests: jest.fn(),
    };
    auditEvents = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    controller = new RegistrationRequestsController(
      requests as unknown as RegistrationRequestsService,
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("records durable registration create-request evidence", async () => {
    requests.createRequest.mockResolvedValueOnce(
      request({ status: "pending" }),
    );

    await controller.create(
      {
        manifest: request().manifest,
        requestedBy: "github:commerce/orders",
      } as any,
      { user: { sub: "operator-1" }, correlationId: "corr-register" } as any,
    );

    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "registry.service.create_requested",
        actionFamily: "registration",
        actor: "operator-1",
        resourceType: "registry_change_request",
        resourceId: "request-1",
        environment: "test",
        correlationId: "corr-register",
      }),
    );
  });

  it("records durable registration evidence after approval", async () => {
    requests.approveRequest.mockResolvedValueOnce(request());

    await controller.approve("request-1", {
      user: { sub: "operator-1" },
    } as any);

    expect(requests.approveRequest).toHaveBeenCalledWith(
      "request-1",
      "operator-1",
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval.request.approved",
        actionFamily: "approval",
        actor: "operator-1",
        serviceId: "orders",
        resourceType: "registry_change_request",
        resourceId: "request-1",
        environment: "test",
        correlationId: "request-1",
        severity: "info",
        message: "Registration request approved for orders",
        payload: {
          requestId: "request-1",
          ownerTribeId: "commerce",
          status: "applied",
          appliedServiceId: "orders",
          rejectionReason: null,
        },
      }),
    );
  });

  it("fails closed when registration approval audit evidence cannot be written", async () => {
    requests.approveRequest.mockResolvedValueOnce(request());
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.approve("request-1", { user: { sub: "operator-1" } } as any),
    ).rejects.toThrow("audit unavailable");
  });

  it("records durable registration evidence after rejection", async () => {
    requests.rejectRequest.mockResolvedValueOnce(
      request({
        status: "rejected",
        approvedBy: null,
        rejectedBy: "operator-2",
        appliedServiceId: null,
        rejectionReason: "Missing owner approval.",
        appliedAt: null,
      }),
    );

    await controller.reject(
      "request-1",
      { reason: "Missing owner approval." },
      { user: { sub: "operator-2" } } as any,
    );

    expect(requests.rejectRequest).toHaveBeenCalledWith(
      "request-1",
      "operator-2",
      "Missing owner approval.",
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "approval.request.rejected",
        actionFamily: "approval",
        actor: "operator-2",
        serviceId: "orders",
        resourceType: "registry_change_request",
        resourceId: "request-1",
        environment: "test",
        correlationId: "request-1",
        severity: "warning",
        message: "Registration request rejected for orders",
        payload: {
          requestId: "request-1",
          ownerTribeId: "commerce",
          status: "rejected",
          appliedServiceId: null,
          rejectionReason: "Missing owner approval.",
        },
      }),
    );
  });
});
