import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const read = (path: string) => readFileSync(path, "utf8");
const contract = z
  .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
  .parse(parse(read("contracts/public/apicenter.openapi.yaml")));
const inventory = z
  .object({
    sdkOperations: z.array(
      z.object({
        operationId: z.string(),
        serviceId: z.string(),
        method: z.string(),
        path: z.string(),
        requiredScopes: z.array(z.string()),
        idempotencyKey: z.unknown().optional(),
      }),
    ),
  })
  .parse(JSON.parse(read("packages/contracts/shared-service-contract.json")));
const operation = z.object({
  operationId: z.string(),
  security: z.array(z.record(z.string(), z.array(z.string()))),
  "x-required-scopes": z.array(z.string()),
  responses: z.record(z.string(), z.unknown()),
  parameters: z
    .array(z.object({ $ref: z.string().optional() }).passthrough())
    .optional(),
});

describe("shared-service consumer HTTP contract", () => {
  it("pins the same YAML document for SDK and documentation consumers", () => {
    expect(
      JSON.parse(read("packages/contracts/apicenter-openapi.json")),
    ).toEqual(parse(read("contracts/public/apicenter.openapi.yaml")));
  });

  it.each(inventory.sdkOperations)(
    "publishes $operationId with runtime scopes and bearer authentication",
    (item) => {
      const documented = operation.parse(
        contract.paths[item.path]?.[item.method.toLowerCase()],
      );
      const manifest = z
        .object({ requiredScopes: z.array(z.string()) })
        .parse(
          JSON.parse(read(`apps/${item.serviceId}/service-manifest.json`)),
        );
      expect(documented.operationId).toBe(item.operationId);
      expect(documented.security).toEqual([{ ServiceBearerAuth: [] }]);
      expect(documented["x-required-scopes"].sort()).toEqual(
        manifest.requiredScopes.sort(),
      );
      expect(documented["x-required-scopes"].sort()).toEqual(
        [...item.requiredScopes].sort(),
      );
      const hasIdempotency =
        documented.parameters?.some(
          (parameter) =>
            parameter.$ref === "#/components/parameters/IdempotencyKey",
        ) ?? false;
      expect(hasIdempotency).toBe(Boolean(item.idempotencyKey));
      const expectedStatus = [
        "email.send",
        "sms.send",
        "otp.generate",
      ].includes(item.operationId)
        ? "201"
        : "200";
      expect(documented.responses[expectedStatus]).toBeDefined();
    },
  );

  it("keeps identity bootstrap unauthenticated and excludes private control-plane routes", () => {
    for (const route of ["/api/v1/auth/token", "/api/v1/auth/token/refresh"]) {
      const value = z
        .object({ security: z.array(z.unknown()) })
        .parse(contract.paths[route]?.post);
      expect(value.security).toEqual([]);
    }
    expect(contract.paths["/api/v1/auth/token/revoke"]?.post).toMatchObject({
      responses: { "204": expect.any(Object) },
    });
    expect(
      Object.keys(contract.paths).every(
        (route) => !/\/admin\/|\/webhooks\/|\/verify-token$/.test(route),
      ),
    ).toBe(true);
  });
});
