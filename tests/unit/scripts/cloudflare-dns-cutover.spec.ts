const {
  buildCutoverConfig,
  runCloudflareDnsCutover,
} = require("../../../scripts/cloudflare-dns-cutover");

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("cloudflare-dns-cutover", () => {
  const baseEnv = {
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ZONE_ID: "zone-123",
  };

  it("builds the default cutover config for api-center", () => {
    expect(buildCutoverConfig(baseEnv, [])).toEqual(
      expect.objectContaining({
        apiToken: "cf-token",
        zoneId: "zone-123",
        zoneName: "itsandbox.site",
        recordName: "api-center.itsandbox.site",
        expectedCurrentIp: "136.110.192.169",
        targetIp: "136.68.196.7",
        rollback: false,
        dryRun: false,
      }),
    );
  });

  it("switches expected and target IPs for rollback", () => {
    expect(buildCutoverConfig(baseEnv, ["--rollback"])).toEqual(
      expect.objectContaining({
        expectedCurrentIp: "136.68.196.7",
        targetIp: "136.110.192.169",
        rollback: true,
      }),
    );
  });

  it("fails before network calls when the API token is missing", async () => {
    const fetchImpl = jest.fn();

    await expect(
      runCloudflareDnsCutover({
        env: { CLOUDFLARE_ZONE_ID: "zone-123" },
        argv: [],
        fetchImpl,
        log: jest.fn(),
      }),
    ).rejects.toThrow("CLOUDFLARE_API_TOKEN");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("patches the A record while preserving TTL and proxy mode", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: [
            {
              id: "record-123",
              type: "A",
              name: "api-center.itsandbox.site",
              content: "136.110.192.169",
              ttl: 1,
              proxied: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          result: {
            id: "record-123",
            content: "136.68.196.7",
            ttl: 1,
            proxied: true,
          },
        }),
      );

    const result = await runCloudflareDnsCutover({
      env: baseEnv,
      argv: [],
      fetchImpl,
      log: jest.fn(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        changed: true,
        beforeIp: "136.110.192.169",
        afterIp: "136.68.196.7",
      }),
    );
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/record-123",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          type: "A",
          name: "api-center.itsandbox.site",
          content: "136.68.196.7",
          ttl: 1,
          proxied: true,
        }),
      }),
    );
  });

  it("does not patch in dry-run mode", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: [
          {
            id: "record-123",
            type: "A",
            name: "api-center.itsandbox.site",
            content: "136.110.192.169",
            ttl: 1,
            proxied: false,
          },
        ],
      }),
    );

    const result = await runCloudflareDnsCutover({
      env: baseEnv,
      argv: ["--dry-run"],
      fetchImpl,
      log: jest.fn(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        changed: false,
        dryRun: true,
        beforeIp: "136.110.192.169",
        afterIp: "136.68.196.7",
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to patch when the current record is not the expected IP", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: [
          {
            id: "record-123",
            type: "A",
            name: "api-center.itsandbox.site",
            content: "203.0.113.10",
            ttl: 1,
            proxied: false,
          },
        ],
      }),
    );

    await expect(
      runCloudflareDnsCutover({
        env: baseEnv,
        argv: [],
        fetchImpl,
        log: jest.fn(),
      }),
    ).rejects.toThrow("expected current IP");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
