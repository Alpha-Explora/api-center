const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectComplianceExportEvidence,
  writeComplianceExportEvidence,
  sanitize,
} = require("./collect-compliance-export-evidence.js");

async function run(name, fn) {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function createFetch(routes) {
  return async (url, init) => {
    const route = routes[url];
    if (!route) throw new Error("No route for " + url);
    if (route.assertHeaders) route.assertHeaders(init.headers);
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      async text() {
        return JSON.stringify(route.body);
      },
    };
  };
}

(async () => {
  await run("captures ready compliance export with durable audit metadata", async () => {
    const fetchImpl = createFetch({
      "https://api.example.com/api/v1/admin/compliance/export?from=2026-01-01&to=2026-01-31&format=json": {
        status: 200,
        assertHeaders(headers) {
          assert.equal(headers["x-platform-secret"], "secret-value");
        },
        body: {
          success: true,
          data: { summary: { auditEventCount: 1 } },
          meta: {
            sourceMetadata: [
              {
                sourceType: "durable",
                sourceName: "audit-events-postgres",
                durability: "postgres",
                evidenceTable: "apic_audit.audit_events",
              },
              {
                sourceType: "volatile",
                sourceName: "promotion-evidence-memory-bundles",
                durability: "none",
              },
            ],
          },
        },
      },
    });

    const evidence = await collectComplianceExportEvidence({
      now: "2026-06-26T00:00:00.000Z",
      from: "2026-01-01",
      to: "2026-01-31",
      apiCenterBaseUrl: "https://api.example.com/",
      platformSecret: "secret-value",
      fetchImpl,
    });

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
    assert.equal(evidence.apiCenter.auditDurability, "durable");
    assert.equal(evidence.apiCenter.sourceMetadataPresent, true);
  });

  await run("blocks when no endpoint URLs are configured", async () => {
    const evidence = await collectComplianceExportEvidence({
      now: "2026-06-26T00:00:00.000Z",
      env: {},
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });

    assert.equal(evidence.ready, false);
    assert.deepEqual(evidence.blockers, [
      "API_CENTER_BASE_URL/APICENTER_URL or MANAGEMENT_BASE_URL/APICENTER_MANAGEMENT_URL is required.",
    ]);
  });

  await run("blocks API Center smoke without admin credentials", async () => {
    const evidence = await collectComplianceExportEvidence({
      apiCenterBaseUrl: "https://api.example.com",
      fetchImpl: async () => ({ status: 200, ok: true, text: async () => "{}" }),
    });

    assert.equal(evidence.ready, false);
    assert.equal(
      evidence.blockers.includes("API Center compliance export requires API_CENTER_PLATFORM_ADMIN_SECRET/PLATFORM_ADMIN_SECRET or API_CENTER_ADMIN_BEARER_TOKEN."),
      true,
    );
  });

  await run("blocks when source metadata is missing", async () => {
    const fetchImpl = createFetch({
      "https://api.example.com/api/v1/admin/compliance/export?from=2026-01-01&to=2026-12-31&format=json": {
        status: 200,
        body: { success: true, data: { summary: {} } },
      },
    });

    const evidence = await collectComplianceExportEvidence({
      apiCenterBaseUrl: "https://api.example.com",
      adminBearerToken: "admin.jwt",
      fetchImpl,
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("api_center compliance export did not include source metadata."), true);
  });

  await run("smokes management proxy when management auth is provided", async () => {
    const fetchImpl = createFetch({
      "https://management.example.com/api/local/compliance/export?from=2026-01-01&to=2026-12-31&format=json": {
        status: 200,
        assertHeaders(headers) {
          assert.equal(headers.authorization, "Bearer mgmt-token");
        },
        body: {
          success: true,
          data: { summary: {} },
          meta: {
            sourceMetadata: [
              {
                sourceType: "durable",
                sourceName: "audit-events-postgres",
                durability: "postgres",
                evidenceTable: "apic_audit.audit_events",
              },
            ],
          },
        },
      },
    });

    const evidence = await collectComplianceExportEvidence({
      managementBaseUrl: "https://management.example.com",
      managementBearerToken: "mgmt-token",
      fetchImpl,
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.management.auditDurability, "durable");
  });

  await run("allows local-dev management smoke without bearer token", async () => {
    const fetchImpl = createFetch({
      "http://localhost:3000/api/local/compliance/export?from=2026-01-01&to=2026-12-31&format=json": {
        status: 200,
        assertHeaders(headers) {
          assert.equal(headers.authorization, undefined);
        },
        body: {
          success: true,
          data: { summary: {} },
          meta: {
            sourceMetadata: [
              {
                sourceType: "durable",
                sourceName: "audit-events-postgres",
                durability: "postgres",
                evidenceTable: "apic_audit.audit_events",
              },
            ],
          },
        },
      },
    });

    const evidence = await collectComplianceExportEvidence({
      env: { MANAGEMENT_AUTH_MODE: "local-dev" },
      managementBaseUrl: "http://localhost:3000",
      fetchImpl,
    });

    assert.equal(evidence.ready, true);
  });

  await run("sanitizes secrets and writes evidence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-compliance-evidence-"));
    try {
      const output = sanitize("Bearer abc.def secret=top password=hunter2 postgresql://user:pass@example/db sbp_token");
      assert.equal(output.includes("abc.def"), false);
      assert.equal(output.includes("secret=top"), false);
      assert.equal(output.includes("password=hunter2"), false);
      assert.equal(output.includes("postgresql://user"), false);
      assert.equal(output.includes("sbp_token"), false);

      const outPath = path.join(root, "compliance.json");
      const evidence = await collectComplianceExportEvidence({ env: {}, fetchImpl: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
      writeComplianceExportEvidence(evidence, outPath);
      const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
      assert.equal(written.ready, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
})();
