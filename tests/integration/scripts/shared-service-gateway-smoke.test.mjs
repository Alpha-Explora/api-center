import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { classifyGatewayResponse, runSharedServiceGatewaySmoke, services } = require("../../../scripts/shared-service-gateway-smoke.cjs");

test("classifies a JSON success and only a known runtime missing-resource response as reachable", () => {
  assert.deepEqual(classifyGatewayResponse({ status: 200, contentType: "application/json", bodyText: "{}" }), {
    ok: true,
    classification: "json-success",
  });
  assert.deepEqual(classifyGatewayResponse({ status: 404, contentType: "application/json", bodyText: JSON.stringify({ code: "NOT_FOUND" }), expectedStatuses: [404], expectedErrorCodes: ["NOT_FOUND"] }), {
    ok: true,
    classification: "expected-runtime-error",
  });
  assert.equal(classifyGatewayResponse({ status: 404, contentType: "application/json", bodyText: "{}", expectedStatuses: [404], expectedErrorCodes: ["NOT_FOUND"] }).ok, false);
});

test("sends one authenticated safe request through the gateway for every shared service", async () => {
  const requests = [];
  const results = await runSharedServiceGatewaySmoke({
    baseUrl: "https://gateway.example/",
    bearerToken: "smoke-token",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const descriptor = services[requests.length - 1];
      const missing = descriptor.expectedErrorCodes?.[0];
      return {
        status: missing ? 404 : 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(missing ? { code: missing } : { ok: true }),
      };
    },
  });

  assert.equal(requests.length, services.length);
  assert.equal(results.length, services.length);
  assert.ok(requests.every(({ url, init }) => url.startsWith("https://gateway.example/api/v1/")));
  assert.ok(requests.every(({ init }) => init.headers.Authorization === "Bearer smoke-token"));
  assert.match(requests[0].url, /\/api\/v1\/payments\/checkouts\/apicenter-smoke-/);
  assert.ok(requests.every(({ url }) => !url.includes("undefined")));
});

test("sanitizes transport failures without exposing the bearer token", async () => {
  await assert.rejects(
    runSharedServiceGatewaySmoke({ baseUrl: "https://gateway.example", bearerToken: "secret-value", fetchImpl: async () => { throw new Error("secret-value network error"); } }),
    (error) => error.message.includes("transport-error") && !error.message.includes("secret-value"),
  );
});

test("rejects HTML, invalid JSON, and gateway upstream errors", () => {
  assert.equal(classifyGatewayResponse({ status: 404, contentType: "text/html", bodyText: "<html />", expectedStatuses: [404] }).ok, false);
  assert.equal(classifyGatewayResponse({ status: 200, contentType: "application/json", bodyText: "not json" }).ok, false);
  assert.equal(classifyGatewayResponse({ status: 502, contentType: "application/json", bodyText: "{}" }).classification, "gateway-upstream-failure");
  assert.equal(classifyGatewayResponse({ status: 503, contentType: "application/json", bodyText: "{}" }).classification, "gateway-upstream-failure");
});
