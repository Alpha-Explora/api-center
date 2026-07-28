// =============================================================================
// Unit tests â€” ServiceManifestDto URL validation
// =============================================================================

import { validate } from "class-validator";
import { describe, expect, it } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { ServiceManifestDto } from "../../../../../apps/gateway/src/shared/dto/service-manifest.dto";

describe("ServiceManifestDto", () => {
  const baseManifest = {
    serviceId: "demand-service",
    name: "Demand Service",
    baseUrl: "http://demand-service:4100",
    requiredScopes: ["demand:read"],
    exposes: ["GET /demand/:id"],
    consumes: ["logistics-service"],
    ownerTribeId: "demand",
    healthCheck: "/health",
    version: "1.0.0",
    serviceType: "tribe",
  };

  const transform = (plain: Record<string, unknown>) =>
    plainToInstance(ServiceManifestDto, plain);

  it("accepts Docker-internal hostnames with explicit protocol", async () => {
    const dto = transform(baseManifest);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts public HTTP URLs", async () => {
    const dto = transform({
      ...baseManifest,
      baseUrl: "https://api.example.com",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects URL without protocol", async () => {
    const dto = transform({
      ...baseManifest,
      baseUrl: "demand-service:4100",
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects non-http protocols", async () => {
    const dto = transform({
      ...baseManifest,
      baseUrl: "ftp://demand-service:4100",
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts ownerTribeId for microservices owned by a tribe", async () => {
    const dto = transform({
      ...baseManifest,
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      name: "Logistics Orders",
      baseUrl: "http://logistics-orders:3000",
      requiredScopes: ["orders:read"],
      exposes: ["/orders", "/health"],
      consumes: ["payment"],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it("rejects likely tribe microservices without ownerTribeId", async () => {
    const dto = transform({
      ...baseManifest,
      serviceId: "logistics-orders",
      ownerTribeId: undefined,
      name: "Logistics Orders",
      baseUrl: "http://logistics-orders:3000",
      requiredScopes: ["orders:read"],
      exposes: ["/orders", "/health"],
      consumes: [],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "ownerTribeId")).toBe(
      true,
    );
  });

  it("accepts root tribe service manifests without ownerTribeId", async () => {
    const dto = transform({
      ...baseManifest,
      serviceId: "logistics",
      ownerTribeId: undefined,
      name: "Logistics",
      baseUrl: "http://logistics:3000",
      requiredScopes: ["logistics:read"],
      exposes: ["/health"],
      consumes: [],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it("rejects duplicate service environment keys", async () => {
    const dto = transform({
      ...baseManifest,
      environments: [
        {
          environment: "test",
          baseUrl: "https://demand-test.example.com",
          healthCheck: "/health",
        },
        {
          environment: "test",
          baseUrl: "https://demand-test-2.example.com",
          healthCheck: "/health",
        },
      ],
    });

    const errors = await validate(dto);

    expect(
      errors.some(
        (error) =>
          error.property === "environments" &&
          error.constraints?.arrayUnique === "Environment keys must be unique",
      ),
    ).toBe(true);
  });

  it("rejects invalid ownerTribeId values", async () => {
    const dto = transform({
      ...baseManifest,
      serviceId: "logistics-orders",
      ownerTribeId: "Logistics Orders!",
      name: "Logistics Orders",
      baseUrl: "http://logistics-orders:3000",
      requiredScopes: ["orders:read"],
      exposes: ["/orders"],
      consumes: [],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "ownerTribeId")).toBe(
      true,
    );
  });
});
