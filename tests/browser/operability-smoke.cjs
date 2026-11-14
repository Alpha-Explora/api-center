const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const root = path.resolve(__dirname, "../..");
const serviceId = "operability-browser-fixture";
const keyId = randomUUID();
const calls = [];
let run = null;
let revoked = false;
const service = {
  serviceId,
  name: "Browser fixture",
  serviceType: "tribe",
  projectId: "fixture-project",
  ownerTribeId: "fixture-tribe",
  baseUrl: "https://fixture.example.test",
  requiredScopes: ["payments:read"],
  exposes: ["/fixture"],
  consumes: ["payment"],
  version: "1.0.0",
  status: "active",
  registeredAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  environments: ["test", "live"].map((environment) => ({
    environment,
    baseUrl: "https://fixture.example.test",
    status: "active",
  })),
};
const gateway = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : null;
  calls.push({ path: url.pathname, method: req.method, body });
  let response = { success: true, data: [] };
  if (url.pathname === "/api/v1/registry/services") response.data = [service];
  if (url.pathname === "/api/v1/registry/services/" + serviceId)
    response.data = service;
  if (url.pathname === "/api/v1/admin/payments/consumers")
    response.data = [
      {
        consumerServiceId: serviceId,
        environment: "live",
        keys: [
          {
            keyId,
            keyPrefix: "live_fixture",
            scopes: ["payments:read"],
            createdAt: new Date().toISOString(),
            expiresAt: null,
            revokedAt: revoked ? new Date().toISOString() : null,
            lastUsedAt: null,
          },
        ],
      },
    ];
  if (url.pathname.includes("/admin/operations/evidence/"))
    response = {
      success: true,
      data: {
        sections: [
          { key: "manifest", status: "pass" },
          { key: "pipeline", status: "not_applicable" },
          { key: "smoke", status: "fail" },
        ],
      },
      meta: {
        verification: {
          checks: [{ checkId: "authentication", status: "missing" }],
          secret: null,
          run,
        },
      },
    };
  if (url.pathname === "/api/v1/admin/operations/verification/runs") {
    run = { runId: randomUUID(), status: "queued" };
    response.data = run;
  }
  if (url.pathname.endsWith("/keys/revoke")) revoked = true;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
});

async function main() {
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:3107";
  const mock = "http://127.0.0.1:" + gateway.address().port;
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3107",
    ],
    {
      cwd: path.join(root, "apps/management"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        MANAGEMENT_AUTH_MODE: "local-dev",
        MANAGEMENT_ENVIRONMENT: "test",
        MANAGEMENT_PUBLIC_BASE_URL: base,
        API_CENTER_BASE_URL: mock,
        APICENTER_GATEWAY_URL: mock,
        NEXT_PUBLIC_API_CENTER_BASE_URL: mock,
        API_CENTER_PLATFORM_ADMIN_SECRET: "fixture-only",
        APICENTER_PLATFORM_SECRET: "fixture-only",
        API_CENTER_CLOUD_RUN_AUTH_ENABLED: "false",
        VERCEL: "",
        RENDER: "",
      },
    },
  );
  let log = "";
  for (const output of [child.stdout, child.stderr])
    output.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-4000);
    });
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch(base + "/api/local/registry/services")).ok) break;
      } catch {}
      if (child.exitCode !== null) throw new Error(log);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/tribes/" + serviceId + "?section=governance");
    await page
      .getByText("Production handoff is blocked by the checks below.")
      .waitFor({ timeout: 90000 });
    const verify = page.getByRole("button", {
      name: "Request protected verification",
    });
    assert.equal(await verify.isDisabled(), true);
    await page
      .getByLabel("Operation reason", { exact: true })
      .fill("Browser fixture verification");
    assert.equal(await verify.isDisabled(), true);
    await page
      .getByLabel("Type APPLY LIVE CHANGE", { exact: true })
      .fill("APPLY LIVE CHANGE");
    await verify.click();
    await page.getByText(/Verification run: queued/).waitFor();
    assert.equal(
      calls.filter(
        (call) => call.path === "/api/v1/admin/operations/verification/runs",
      ).length,
      1,
    );
    await page
      .getByRole("button", { name: "Revoke this key", exact: true })
      .click();
    await page.getByText(/^Revoked:/).waitFor();
    const revoke = calls.find((call) => call.path.endsWith("/keys/revoke"));
    assert.equal(revoke.body.keyId, keyId);
    assert.equal(revoke.body.environment, "live");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.goto(base + "/audit");
    await page
      .getByText("Enter a correlation ID to look up a request.")
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: rendered blocked readiness, enforced live confirmation, queued one run, revoked the selected key, and rendered mobile/Audit states through real Management routes.",
    );
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    await browser?.close();
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {}
    } else child.kill("SIGTERM");
    gateway.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
