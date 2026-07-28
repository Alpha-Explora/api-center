import { GovernanceDriftService } from "../../../../apps/gateway/src/operations/governance-drift.service";

describe("GovernanceDriftService", () => {
  it("flags management intent that is not active in runtime", () => {
    const service = new GovernanceDriftService();

    const result = service.compare({
      management: {
        quotaPolicies: [
          { id: "quota-1", ownerTribeId: "campus-one", mode: "enforce" },
        ],
        planAssignments: [
          { id: "plan-1", ownerTribeId: "campus-one", planKey: "standard" },
        ],
      },
      runtime: {
        quotaPolicies: [],
        planAssignments: [
          { id: "plan-1", ownerTribeId: "campus-one", planKey: "standard" },
        ],
      },
    });

    expect(result.status).toBe("drifted");
    expect(result.items).toEqual([
      {
        severity: "critical",
        resourceType: "quotaPolicy",
        resourceId: "quota-1",
        ownerTribeId: "campus-one",
        message:
          "Quota policy is configured in Management but not active in API Center runtime.",
      },
    ]);
  });
});
