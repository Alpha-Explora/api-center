import { ConfigService } from "../config/config.service";
import { DataPipelineDisabledError } from "./data-pipeline-disabled.error";
import { PipelineHealthController } from "./pipeline-health.controller";
import { PipelineGovernanceService } from "./pipeline-governance.service";
import { PipelineHealthService } from "./pipeline-health.service";
import { RawToSilverRunService } from "./raw-to-silver-run.service";

describe("PipelineHealthController", () => {
  it("rejects raw-to-silver runs when the data pipeline is disabled", async () => {
    const rawToSilverRuns = {
      startRun: jest.fn(),
    } as unknown as RawToSilverRunService;
    const controller = new PipelineHealthController(
      {} as PipelineHealthService,
      {} as PipelineGovernanceService,
      rawToSilverRuns,
      { dataPipeline: { enabled: false } } as ConfigService,
    );

    await expect(
      controller.startRawToSilverRun(
        {
          environment: "test",
          tribeId: "logistics",
          year: "2026",
          month: "06",
          day: "10",
        },
        { correlationId: "corr-1" } as never,
      ),
    ).rejects.toBeInstanceOf(DataPipelineDisabledError);
    expect(rawToSilverRuns.startRun).not.toHaveBeenCalled();
  });
});
