import { ServiceLifecycleEvidenceController } from "../../../../src/operations/service-lifecycle-evidence.controller";
import { ServiceLifecycleEvidenceService } from "../../../../src/operations/service-lifecycle-evidence.service";

describe("ServiceLifecycleEvidenceController", () => {
  it("returns lifecycle evidence for all registry services", async () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        "student-api": {
          serviceId: "student-api",
          name: "Student API",
          baseUrl: "https://students.example.test",
          requiredScopes: ["students:read"],
          exposes: ["/students"],
          consumes: [],
          ownerTribeId: "campus-one",
          serviceType: "tribe",
          healthCheck: "/health",
          version: "1.0.0",
          ownerTeam: "Campus",
          contact: "campus@example.test",
          registeredAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-14T00:00:00.000Z",
          status: "active",
          healthy: true,
        },
      }),
    };
    const quotaPolicies = { listPolicies: jest.fn().mockResolvedValue([]) };
    const plans = { listPlanAssignments: jest.fn().mockResolvedValue([]) };
    const approvals = { listRequests: jest.fn().mockResolvedValue([]) };
    const pipelineHealth = { listHealth: jest.fn().mockResolvedValue([]) };
    const controller = new ServiceLifecycleEvidenceController(
      registry as any,
      quotaPolicies as any,
      plans as any,
      approvals as any,
      pipelineHealth as any,
      new ServiceLifecycleEvidenceService(),
    );

    const response = await controller.getLifecycle();

    expect(response.success).toBe(true);
    expect(response.data.entries[0].service.serviceId).toBe("student-api");
    expect(quotaPolicies.listPolicies).toHaveBeenCalledWith();
    expect(plans.listPlanAssignments).toHaveBeenCalledWith({
      status: "active",
    });
    expect(approvals.listRequests).toHaveBeenCalledWith();
    expect(pipelineHealth.listHealth).toHaveBeenCalledWith("live");
  });
});
