const test = require("node:test");
const assert = require("node:assert/strict");
const { verify } = require("../../../scripts/release/verify-release.cjs");
const {
  createReport,
  finalize,
} = require("../../../scripts/release/release-report.cjs");
const {
  runConsumerChecks,
} = require("../../../scripts/release/consumer-checks.cjs");
const {
  observeDeployment,
} = require("../../../scripts/release/deployment-identity.cjs");
const sha = "a".repeat(40);
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

test("the real CLI writes blocked evidence and refuses to overwrite an existing attempt", () => {
  const destination = join(
    mkdtempSync(join(tmpdir(), "apicenter-verification-test-")),
    "report.json",
  );
  const args = [
    "scripts/release/verify-release.cjs",
    "--phase",
    "deployed",
    "--output",
    destination,
  ];
  const env = {
    ...process.env,
    APICENTER_URL: "",
    APICENTER_SERVICE_ID: "",
    APICENTER_SERVICE_SECRET: "",
    APICENTER_VERIFY_DEPLOYMENTS: "[]",
  };
  const first = spawnSync(process.execPath, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(first.status, 1);
  const original = readFileSync(destination, "utf8");
  const report = JSON.parse(original);
  assert.equal(report.releasable, false);
  assert.ok(report.checks.every((check) => check.status === "blocked"));
  const repeated = spawnSync(process.execPath, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(repeated.status, 1);
  assert.equal(readFileSync(destination, "utf8"), original);
});

test("configured live provider cases cannot bypass a durable claim", async () => {
  let effects = 0;
  const request = async (url, options) => {
    const route = new URL(url).pathname;
    if (route.endsWith("/auth/token"))
      return Response.json(
        {
          success: true,
          data: {
            serviceId: "consumer",
            environment: "live",
            accessToken: "token",
          },
        },
        { status: 201 },
      );
    if (route.endsWith("/shared"))
      return options.headers?.Authorization
        ? Response.json({ success: true, data: [{ serviceId: "email" }] })
        : new Response(null, { status: 401 });
    if (route.endsWith("/email/send")) effects++;
    return Response.json({ status: "ok" });
  };
  const checks = await runConsumerChecks(
    {
      baseUrl: "https://fixture.example.test",
      serviceId: "consumer",
      environment: "live",
      secret: "fixture",
    },
    {
      request,
      deployments: [{ serviceId: "email", production: true }],
      env: {
        APICENTER_VERIFY_CASES: JSON.stringify([
          { checkId: "provider.email", body: { to: "fixture@example.test" } },
        ]),
        APICENTER_VERIFY_ALLOW_LIVE_CASES: "provider.email",
        APICENTER_VERIFY_LIVE_PHRASE: "APPLY LIVE CHANGE",
        APICENTER_VERIFY_LIVE_REASON: "Fixture",
        APICENTER_VERIFY_RECIPIENT_ALLOWLIST: '["fixture@example.test"]',
      },
    },
  );
  assert.equal(effects, 0);
  assert.ok(
    checks.some(
      (check) =>
        check.checkId === "provider.email" &&
        check.errorCode === "VERIFICATION_CLAIM_REQUIRED",
    ),
  );
});
test("dirty repository results remain explicitly not releasable", async () => {
  const report = await verify({
    expectedCommit: sha,
    dirty: true,
    execute: async () => {},
  });
  assert.equal(report.releasable, false);
  assert.ok(report.checks.every((check) => check.status === "passed"));
});
test("required skipped and blocked cases prevent acceptance", () => {
  for (const status of ["skipped", "blocked", "failed"]) {
    const report = createReport({
      commit: sha,
      dirty: false,
      environment: "test",
      phase: "all",
    });
    report.deployments = [
      {
        service: "gateway",
        revision: "gateway-1",
        commit: sha,
        imageDigest: "image@sha256:" + sha,
      },
    ];
    report.checks = [{ checkId: "authentication", status, required: true }];
    assert.equal(finalize(report).releasable, false);
  }
});
test("all repository commands run even after one fails", async () => {
  let count = 0;
  const report = await verify({
    expectedCommit: sha,
    dirty: false,
    execute: async () => {
      if (++count === 1) throw new Error("do not persist this secret");
    },
  });
  assert.ok(count > 1);
  assert.equal(report.checks[0].status, "failed");
  assert.doesNotMatch(JSON.stringify(report), /persist this secret/);
});
test("missing acceptance credentials and identity block deployment verification", async () => {
  const report = await verify({
    expectedCommit: sha,
    dirty: false,
    phase: "deployed",
  });
  assert.equal(report.releasable, false);
  assert.deepEqual(
    report.checks.map((check) => check.status),
    ["blocked", "blocked"],
  );
});
test("consumer checks never send messages or make payment commands", async () => {
  const urls = [];
  const secret = "server-only-secret";
  const request = async (url, options) => {
    urls.push({ path: new URL(url).pathname, method: options.method || "GET" });
    if (String(url).endsWith("/auth/token"))
      return Response.json(
        {
          success: true,
          data: {
            serviceId: "consumer",
            environment: "live",
            accessToken: "token",
          },
        },
        { status: 201 },
      );
    if (String(url).endsWith("/shared"))
      return options.headers?.Authorization
        ? Response.json({
            success: true,
            data: [{ serviceId: "email" }, { serviceId: "gauth" }],
          })
        : new Response(null, { status: 401 });
    return Response.json({ status: "ok" });
  };
  const results = await runConsumerChecks(
    {
      baseUrl: "https://api.example.test",
      serviceId: "consumer",
      environment: "live",
      secret,
    },
    { request, env: {} },
  );
  assert.ok(
    results.some(
      (check) =>
        check.checkId === "provider.email" && check.status === "blocked",
    ),
  );
  assert.ok(
    results.some(
      (check) =>
        check.checkId === "provider.gauth" && check.status === "blocked",
    ),
  );
  assert.deepEqual(
    urls.filter((call) => call.method === "POST").map((call) => call.path),
    ["/api/v1/auth/token"],
  );
  assert.doesNotMatch(JSON.stringify(results), new RegExp(secret));
});
test("observed revision comes from deployment output rather than an expected SHA", async () => {
  const request = async (url) =>
    url.includes("/services/")
      ? {
          status: {
            latestReadyRevisionName: "gateway-00001",
            traffic: [{ revisionName: "gateway-00001", percent: 100 }],
          },
        }
      : {
          status: { imageDigest: "image@sha256:" + "c".repeat(64) },
          spec: {
            containers: [
              { env: [{ name: "APICENTER_RELEASE_SHA", value: sha }] },
            ],
          },
        };
  const identity = await observeDeployment(
    { service: "gateway", project: "project-id", region: "asia-southeast1" },
    { request },
  );
  assert.equal(identity.commit, sha);
  assert.equal(identity.revision, "gateway-00001");
});

test("live provider fixtures cannot execute without exact live selection and recipient allowlist", async () => {
  const {
    runProviderCases,
  } = require("../../../scripts/release/provider-cases.cjs");
  let calls = 0;
  const base = {
    providers: ["provider.email"],
    environment: "live",
    runId: "run-id",
    deployments: [{ serviceId: "email", production: true }],
    token: "server-token",
    call: async () => {
      calls++;
      return Response.json(
        { success: true, data: { provider: "resend", messageId: "email-1" } },
        { status: 201 },
      );
    },
  };
  const fixture = JSON.stringify([
    {
      checkId: "provider.email",
      body: {
        to: "fixture@example.test",
        subject: "Verification",
        text: "Test message",
      },
    },
  ]);
  const denied = await runProviderCases({
    ...base,
    env: { APICENTER_VERIFY_CASES: fixture },
  });
  assert.equal(denied[0].status, "blocked");
  assert.equal(calls, 0);
  const enabled = {
    APICENTER_VERIFY_CASES: fixture,
    APICENTER_VERIFY_ALLOW_LIVE_CASES: "provider.email",
    APICENTER_VERIFY_LIVE_PHRASE: "APPLY LIVE CHANGE",
    APICENTER_VERIFY_LIVE_REASON: "Approved fixture delivery",
    APICENTER_VERIFY_RECIPIENT_ALLOWLIST: '["fixture@example.test"]',
  };
  assert.equal(
    (await runProviderCases({ ...base, env: enabled }))[0].status,
    "passed",
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await runProviderCases({
        ...base,
        env: { ...enabled, APICENTER_VERIFY_RECIPIENT_ALLOWLIST: "[]" },
      })
    )[0].status,
    "blocked",
  );
  assert.equal(calls, 1);
});
