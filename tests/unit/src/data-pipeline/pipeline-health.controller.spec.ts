import { ConfigService } from "../../../../src/config/config.service";
import { DataPipelineDisabledError } from "../../../../src/data-pipeline/data-pipeline-disabled.error";
import { PipelineHealthController } from "../../../../src/data-pipeline/pipeline-health.controller";
import { PipelineGovernanceService } from "../../../../src/data-pipeline/pipeline-governance.service";
import { PipelineHealthService } from "../../../../src/data-pipeline/pipeline-health.service";
import { RawToSilverRunService } from "../../../../src/data-pipeline/raw-to-silver-run.service";

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
  it("adds source metadata to pipeline health responses", async () => {
    const pipelineHealth = {
      listHealth: jest.fn().mockResolvedValue([]),
      getResponseSource: jest.fn().mockReturnValue("athena-proxy"),
    };
    const controller = new PipelineHealthController(
      pipelineHealth as unknown as PipelineHealthService,
      {} as PipelineGovernanceService,
      {} as RawToSilverRunService,
      { dataPipeline: { enabled: true } } as ConfigService,
    );

    const response = await controller.getHealth(
      "live",
      undefined,
      undefined,
      undefined,
      { correlationId: "corr-health" } as never,
    );

    expect(response.meta.sourceMetadata).toEqual([
      expect.objectContaining({
        sourceType: "external",
        sourceName: "pipeline-health-athena",
        durability: "athena",
        correlationId: "corr-health",
      }),
    ]);
  });

  it("adds volatile source metadata to fixture-backed governance responses", async () => {
    const pipelineGovernance = {
      listQuality: jest.fn().mockResolvedValue([]),
      getResponseSource: jest.fn().mockReturnValue("evidence-file"),
    };
    const controller = new PipelineHealthController(
      {} as PipelineHealthService,
      pipelineGovernance as unknown as PipelineGovernanceService,
      {} as RawToSilverRunService,
      { dataPipeline: { enabled: true } } as ConfigService,
    );

    const response = await controller.getQuality(
      "test",
      undefined,
      undefined,
      undefined,
      "30",
      { correlationId: "corr-quality" } as never,
    );

    expect(response.meta.sourceMetadata).toEqual([
      expect.objectContaining({
        sourceType: "volatile",
        sourceName: "pipeline-governance-evidence-file",
        durability: "none",
        correlationId: "corr-quality",
      }),
    ]);
  });

});
