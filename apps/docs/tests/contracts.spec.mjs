import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { getDetailedOperations } from "../lib/contracts.ts";
import { buildSnippet } from "../lib/snippets.ts";

const contract = parse(readFileSync("../../contracts/public/apicenter.openapi.yaml", "utf8"));
const resolve = (value) => value?.$ref
  ? value.$ref.slice(2).split("/").reduce((item, key) => item[key], contract)
  : value;

test("published endpoint details describe only contract operations, parameters, and responses", () => {
  const operations = getDetailedOperations();
  const expected = Object.entries(contract.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([method, operation]) => ({ path, method: method.toUpperCase(), operation })),
  );
  assert.deepEqual(operations.map(({ operationId }) => operationId).sort(), expected.map(({ operation }) => operation.operationId).sort());
  for (const { path, method, operation } of expected) {
    const rendered = operations.find((item) => item.operationId === operation.operationId);
    assert.equal(rendered.serverUrl, (operation.servers ?? contract.paths[path].servers ?? contract.servers)[0].url.replace(/\/$/, ""));
    assert.equal(rendered.path, path);
    assert.equal(rendered.method, method);
    const parameters = [...(contract.paths[path].parameters ?? []), ...(operation.parameters ?? [])].map(resolve);
    assert.deepEqual([...rendered.pathParameters, ...rendered.queryParameters, ...rendered.headerParameters]
      .map(({ name, in: location, required }) => ({ name, in: location, required })).sort((a, b) => a.name.localeCompare(b.name)),
    parameters.map(({ name, in: location, required = false }) => ({ name, in: location, required })).sort((a, b) => a.name.localeCompare(b.name)));
    assert.deepEqual(rendered.errorResponses, Object.entries(operation.responses).filter(([code]) => Number(code) >= 400)
      .map(([code, value]) => ({ code: Number(code), description: resolve(value).description })));
    assert.deepEqual(rendered.successResponses.map(({ code, description }) => ({ code, description })),
      Object.entries(operation.responses).filter(([code]) => /^2\d\d$/.test(code))
        .map(([code, value]) => ({ code: Number(code), description: resolve(value).description })));
    if ((operation.security ?? contract.security).length) {
      assert.equal(rendered.credentialKind, 'application');
      assert.match(rendered.authentication, /application key/i);
    } else assert.equal(rendered.credentialKind, 'none');
  }
});

test("HTTP snippets use the server-side application key and explicit body placeholders", () => {
  const operations = getDetailedOperations();
  for (const operation of operations) {
    const ts = buildSnippet(operation, "fetch");
    assert.ok(ts.includes(operation.serverUrl + operation.path));
    assert.ok(buildSnippet({...operation, serverUrl: "https://contract-server.example"}, "cURL").includes("https://contract-server.example" + operation.path));
    if (operation.credentialKind === 'application') assert.match(ts, /APICENTER_API_KEY/);
    else assert.doesNotMatch(ts, /Authorization:/);
    if (operation.successResponses.every(({code}) => code === 204)) assert.doesNotMatch(ts, /response.json/);
    assert.doesNotMatch(ts, /@apicenter\/sdk|client\./);
    if (operation.requiresIdempotency) assert.match(ts, /Idempotency-Key/);
    if (operation.requestProperties.length) assert.match(ts, /body: JSON.stringify\(requestBody\)/);
    if (operation.pathParameters.length) assert.match(ts, /Replace the path placeholders/);
  }
  const refund = operations.find((operation) => operation.operationId === "createRefund");
  assert.match(buildSnippet(refund, "cURL"), /REQUEST_BODY_JSON/);
});
