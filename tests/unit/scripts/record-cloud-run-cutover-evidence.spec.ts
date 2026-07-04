const {
  appendRetentionEvidence,
  buildEvidenceConfig,
  collectCutoverEvidence,
  defaultResolve4,
  formatRetentionRow,
} = require("../../../scripts/record-cloud-run-cutover-evidence");

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("record-cloud-run-cutover-evidence", () => {
  const baseEnv = {
    APICENTER_CLOUD_RUN_BASE_URL: "https://api-center.itsandbox.site",
    APICENTER_CLOUD_RUN_BEARER_TOKEN: "token",
  };

  it("builds production defaults for the API Center cutover host", () => {
    expect(buildEvidenceConfig(baseEnv, [])).toEqual(
      expect.objectContaining({
        baseUrl: "https://api-center.itsandbox.site",
        host: "api-center.itsandbox.site",
        expectedIp: "136.68.196.7",
        skipPayment: false,
        dryRun: false,
      }),
    );
  });

  it("fails when DNS has not moved to the Cloud Run load balancer IP", async () => {
    await expect(
      collectCutoverEvidence({
        env: baseEnv,
        argv: [],
        resolve4: jest.fn().mockResolvedValue(["136.110.192.169"]),
        fetchImpl: jest.fn(),
        now: () => new Date("2026-07-04T03:00:00Z"),
      }),
    ).rejects.toThrow("does not include expected Cloud Run IP");
  });

  it("collects DNS, health, Redis, and payment evidence", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          details: {
            redis: { status: "up" },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          data: {
            service: "paymongo-gateway",
            providerMode: "live",
          },
        }),
      );

    const evidence = await collectCutoverEvidence({
      env: baseEnv,
      argv: [],
      resolve4: jest.fn().mockResolvedValue(["136.68.196.7"]),
      fetchImpl,
      now: () => new Date("2026-07-04T03:00:00Z"),
      measure: async (fn: () => Promise<unknown>) => ({
        ms: 42,
        value: await fn(),
      }),
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        date: "2026-07-04",
        dns: "pass: 136.68.196.7",
        health: "pass: live 200 42ms, ready 200 42ms",
        paymentLive: "pass: 200 42ms",
        redis: "up",
        decision: "keep Cloud Run",
      }),
    );
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api-center.itsandbox.site/api/v1/shared/payment/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("requires a payment token unless payment is explicitly skipped", async () => {
    await expect(
      collectCutoverEvidence({
        env: {
          APICENTER_CLOUD_RUN_BASE_URL: "https://api-center.itsandbox.site",
        },
        argv: [],
        resolve4: jest.fn().mockResolvedValue(["136.68.196.7"]),
        fetchImpl: jest.fn(),
        now: () => new Date("2026-07-04T03:00:00Z"),
      }),
    ).rejects.toThrow("APICENTER_CLOUD_RUN_BEARER_TOKEN");
  });

  it("resolves IPv4 addresses through dns.lookup results", async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: "136.68.196.7", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ]);

    await expect(defaultResolve4("api-center.itsandbox.site", lookup)).resolves.toEqual([
      "136.68.196.7",
    ]);
    expect(lookup).toHaveBeenCalledWith("api-center.itsandbox.site", {
      family: 4,
      all: true,
    });
  });

  it("builds an explicit resolver when DNS servers are configured", async () => {
    const resolve4 = jest.fn().mockImplementation((host, callback) => {
      callback(null, ["136.68.196.7"]);
    });
    const setServers = jest.fn();
    const Resolver = jest.fn().mockImplementation(() => ({
      resolve4,
      setServers,
    }));

    const config = buildEvidenceConfig(
      {
        ...baseEnv,
        APICENTER_CUTOVER_DNS_SERVERS: "1.1.1.1,8.8.8.8",
      },
      [],
    );

    await expect(config.resolve4("api-center.itsandbox.site", { Resolver })).resolves.toEqual([
      "136.68.196.7",
    ]);
    expect(setServers).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
    expect(resolve4).toHaveBeenCalledWith(
      "api-center.itsandbox.site",
      expect.any(Function),
    );
  });

  it("formats and appends the seven-day retention evidence table", () => {
    const evidence = {
      date: "2026-07-04",
      health: "pass: live 200 42ms, ready 200 42ms",
      paymentLive: "pass: 200 42ms",
      redis: "up",
      errorNotes: "none",
      decision: "keep Cloud Run",
    };
    const row = formatRetentionRow(evidence);

    expect(row).toBe(
      "| 2026-07-04 | pass: live 200 42ms, ready 200 42ms | pass: 200 42ms | up | none | keep Cloud Run |",
    );
    expect(appendRetentionEvidence("# Deployment\n", row)).toContain(
      "## Seven-Day Cloud Run Retention Evidence",
    );
    expect(appendRetentionEvidence("# Deployment\n", row)).toContain(row);
  });
});
