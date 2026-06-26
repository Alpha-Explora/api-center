const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectReadinessEvidence,
  writeReadinessEvidence,
  sanitize,
} = require("./collect-readiness-evidence.js");

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
  return async (url) => {
    const route = routes[url];
    if (!route) throw new Error("No route for " + url);
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      async text() {
        return route.body;
      },
    };
  };
}

(async () => {
  await run("captures old/new readiness when endpoints pass", async () => {
    const fetchImpl = createFetch({
      "https://api.example.com/api/v1/health/live": { status: 200, body: '{"status":"ok"}' },
      "https://api.example.com/api/v1/health/ready": { status: 200, body: '{"status":"ready"}' },
      "https://mgmt.example.com/": { status: 200, body: "<html>ok</html>" },
      "https://mgmt.example.com/api/local/deployment/config-check": { status: 200, body: '{"data":{"isDeployed":true}}' },
    });

    const evidence = await collectReadinessEvidence({
      now: "2026-06-26T00:00:00.000Z",
      phase: "old",
      apiCenterBaseUrl: "https://api.example.com/",
      managementBaseUrl: "https://mgmt.example.com/",
      fetchImpl,
    });

    assert.equal(evidence.ready, true);
    assert.deepEqual(evidence.blockers, []);
    assert.equal(evidence.phase, "old");
    assert.equal(evidence.apiCenter.endpoints.length, 2);
    assert.equal(evidence.management.endpoints.length, 2);
    assert.equal(evidence.apiCenter.endpoints[1].body.status, "ready");
  });

  await run("records blockers when URLs are missing", async () => {
    const evidence = await collectReadinessEvidence({
      now: "2026-06-26T00:00:00.000Z",
      env: {},
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });

    assert.equal(evidence.ready, false);
    assert.deepEqual(evidence.blockers, [
      "API_CENTER_BASE_URL or APICENTER_URL is not set.",
      "MANAGEMENT_BASE_URL or APICENTER_MANAGEMENT_URL is not set.",
    ]);
  });

  await run("fails readiness when an endpoint fails", async () => {
    const fetchImpl = createFetch({
      "https://api.example.com/api/v1/health/live": { status: 200, body: '{"status":"ok"}' },
      "https://api.example.com/api/v1/health/ready": { status: 503, body: '{"status":"down"}' },
      "https://mgmt.example.com/": { status: 200, body: "ok" },
      "https://mgmt.example.com/api/local/deployment/config-check": { status: 200, body: '{"data":{"isDeployed":true}}' },
    });

    const evidence = await collectReadinessEvidence({
      phase: "new",
      apiCenterBaseUrl: "https://api.example.com",
      managementBaseUrl: "https://mgmt.example.com",
      fetchImpl,
    });

    assert.equal(evidence.ready, false);
    assert.equal(evidence.blockers.includes("ready readiness check failed."), true);
    assert.equal(evidence.apiCenter.endpoints[1].status, 503);
  });

  await run("sanitizes sensitive body and error content", async () => {
    const output = sanitize("Bearer abc.def password=secret secret=top postgresql://user:pass@example/postgres sbp_token");
    assert.equal(output.includes("abc.def"), false);
    assert.equal(output.includes("password=secret"), false);
    assert.equal(output.includes("secret=top"), false);
    assert.equal(output.includes("postgresql://user"), false);
    assert.equal(output.includes("sbp_token"), false);
  });

  await run("writes readiness evidence to disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apic-readiness-evidence-"));
    try {
      const outPath = path.join(root, "readiness.json");
      const evidence = await collectReadinessEvidence({ env: {}, fetchImpl: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
      writeReadinessEvidence(evidence, outPath);
      const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
      assert.equal(written.ready, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
})();
