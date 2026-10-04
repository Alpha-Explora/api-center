import { GovernanceDriftController } from "../../../../apps/gateway/src/domains/runtime-ops/operations/governance-drift.controller";
import { GovernanceDriftService } from "../../../../apps/gateway/src/domains/runtime-ops/operations/governance-drift.service";

describe("GovernanceDriftController", () => {
  it("returns drift comparison data", () => {
    const drift = {
      compare: jest.fn().mockReturnValue({ status: "in_sync", items: [] }),
    } as unknown as GovernanceDriftService;
    const controller = new GovernanceDriftController(drift);

    expect(
      controller.compare({
        management: { quotaPolicies: [], planAssignments: [] },
        runtime: { quotaPolicies: [], planAssignments: [] },
      }),
    ).toEqual({ success: true, data: { status: "in_sync", items: [] } });
  });
});
