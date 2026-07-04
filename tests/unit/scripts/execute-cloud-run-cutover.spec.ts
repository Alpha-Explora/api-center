const {
  buildOrchestratorConfig,
  executeCloudRunCutover,
  waitForDnsTarget,
} = require("../../../scripts/execute-cloud-run-cutover");

describe("execute-cloud-run-cutover", () => {
  const baseEnv = {
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ZONE_ID: "zone-123",
    APICENTER_CLOUD_RUN_BEARER_TOKEN: "token",
  };

  it("builds production defaults", () => {
    expect(buildOrchestratorConfig(baseEnv, [])).toEqual(
      expect.objectContaining({
        host: "api-center.itsandbox.site",
        targetIp: "136.68.196.7",
        baseUrl: "https://api-center.itsandbox.site",
        dnsTimeoutMs: 120000,
        dnsPollMs: 5000,
        skipDnsCutover: false,
        skipTribeBoundary: false,
      }),
    );
  });

  it("requires Cloudflare credentials unless DNS cutover is skipped", async () => {
    await expect(
      executeCloudRunCutover({
        env: { APICENTER_CLOUD_RUN_BEARER_TOKEN: "token" },
        argv: [],
        runCloudflareDnsCutover: jest.fn(),
        collectCutoverEvidence: jest.fn(),
        appendEvidence: jest.fn(),
        runCommand: jest.fn(),
        resolve4: jest.fn(),
        sleep: jest.fn(),
        log: jest.fn(),
      }),
    ).rejects.toThrow("CLOUDFLARE_API_TOKEN");
  });

  it("waits for DNS, runs smoke commands, and records evidence", async () => {
    const runCloudflareDnsCutover = jest.fn().mockResolvedValue({
      beforeIp: "136.110.192.169",
      afterIp: "136.68.196.7",
    });
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const collectCutoverEvidence = jest.fn().mockResolvedValue({
      date: "2026-07-04",
      health: "pass",
      paymentLive: "pass",
      redis: "up",
      errorNotes: "none",
      decision: "keep Cloud Run",
    });
    const appendEvidence = jest.fn().mockResolvedValue(undefined);

    const result = await executeCloudRunCutover({
      env: baseEnv,
      argv: [],
      runCloudflareDnsCutover,
      collectCutoverEvidence,
      appendEvidence,
      runCommand,
      resolve4: jest.fn().mockResolvedValue(["136.68.196.7"]),
      sleep: jest.fn(),
      log: jest.fn(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        dnsReady: true,
        evidenceRecorded: true,
      }),
    );
    expect(runCloudflareDnsCutover).toHaveBeenCalledWith(
      expect.objectContaining({
        env: baseEnv,
        argv: [],
      }),
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["run", "smoke:cloud-run"],
      expect.objectContaining({
        env: expect.objectContaining({
          APICENTER_CLOUD_RUN_BASE_URL: "https://api-center.itsandbox.site",
          APICENTER_CLOUD_RUN_BEARER_TOKEN: "token",
        }),
      }),
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["run", "smoke:tribe-boundary"],
      expect.objectContaining({
        env: expect.objectContaining({
          APICENTER_URL: "https://api-center.itsandbox.site",
        }),
      }),
    );
    expect(appendEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({ redis: "up" }),
      }),
    );
  });

  it("can skip DNS cutover and tribe-boundary smoke", async () => {
    const runCloudflareDnsCutover = jest.fn();
    const runCommand = jest.fn().mockResolvedValue(undefined);

    await executeCloudRunCutover({
      env: {
        APICENTER_CLOUD_RUN_BEARER_TOKEN: "token",
      },
      argv: ["--skip-dns-cutover", "--skip-tribe-boundary"],
      runCloudflareDnsCutover,
      collectCutoverEvidence: jest.fn().mockResolvedValue({
        date: "2026-07-04",
        health: "pass",
        paymentLive: "pass",
        redis: "up",
        errorNotes: "none",
        decision: "keep Cloud Run",
      }),
      appendEvidence: jest.fn().mockResolvedValue(undefined),
      runCommand,
      resolve4: jest.fn().mockResolvedValue(["136.68.196.7"]),
      sleep: jest.fn(),
      log: jest.fn(),
    });

    expect(runCloudflareDnsCutover).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("rolls DNS back when post-cutover smoke fails and rollback is enabled", async () => {
    const runCloudflareDnsCutover = jest.fn().mockResolvedValue({
      beforeIp: "136.110.192.169",
      afterIp: "136.68.196.7",
    });
    const smokeError = new Error("smoke failed");
    const runCommand = jest.fn().mockRejectedValueOnce(smokeError);

    await expect(
      executeCloudRunCutover({
        env: baseEnv,
        argv: ["--rollback-on-failure"],
        runCloudflareDnsCutover,
        collectCutoverEvidence: jest.fn(),
        appendEvidence: jest.fn(),
        runCommand,
        resolve4: jest.fn().mockResolvedValue(["136.68.196.7"]),
        sleep: jest.fn(),
        log: jest.fn(),
      }),
    ).rejects.toThrow("smoke failed");

    expect(runCloudflareDnsCutover).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        env: baseEnv,
        argv: [],
      }),
    );
    expect(runCloudflareDnsCutover).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        env: baseEnv,
        argv: ["--rollback"],
      }),
    );
  });

  it("times out while waiting for DNS target", async () => {
    await expect(
      waitForDnsTarget({
        host: "api-center.itsandbox.site",
        targetIp: "136.68.196.7",
        timeoutMs: 10,
        pollMs: 5,
        resolve4: jest.fn().mockResolvedValue(["136.110.192.169"]),
        sleep: jest.fn(),
        now: jest
          .fn()
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(11),
        log: jest.fn(),
      }),
    ).rejects.toThrow("Timed out");
  });
});
