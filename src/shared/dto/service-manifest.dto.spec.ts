// =============================================================================
// Unit tests — ServiceManifestDto URL validation
// =============================================================================

import { validate } from "class-validator";
import { describe, expect, it } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { ServiceManifestDto } from "./service-manifest.dto";

describe("ServiceManifestDto", () => {
  const baseManifest = {
    serviceId: "demand-service",
    name: "Demand Service",
    baseUrl: "http://demand-service:4100",
    requiredScopes: ["demand:read"],
    exposes: ["GET /demand/:id"],
    consumes: ["logistics-service"],
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
