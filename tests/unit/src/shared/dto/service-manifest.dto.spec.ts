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
    projectId: "demand-planning",
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

  const gatewayValidation = { whitelist: true, forbidNonWhitelisted: true };

  it("accepts a projectId for tribe services", async () => {
    const errors = await validate(transform({ ...baseManifest, projectId: "logistics-fulfilment" }), gatewayValidation);

    expect(errors).toHaveLength(0);
  });

  it("rejects tribe services without a projectId", async () => {
    const errors = await validate(transform({ ...baseManifest, projectId: undefined }));

    expect(errors.find((error) => error.property === "projectId")?.constraints).toEqual({
      projectId: "projectId is required for tribe services",
    });
  });

  it("rejects shared services that name a project and accepts them without one", async () => {
    const withProject = await validate(transform({ ...baseManifest, serviceType: "shared" }));
    expect(withProject.find((error) => error.property === "projectId")?.constraints).toEqual({
      projectId: "shared services cannot belong to a project",
    });

    const withoutProject = await validate(
      transform({ ...baseManifest, serviceType: "shared", projectId: undefined }),
    );
    expect(withoutProject).toHaveLength(0);
  });

  it("rejects ownerTribeId: the tribe is derived from the project", async () => {
    const errors = await validate(
      transform({ ...baseManifest, ownerTribeId: "demand" }),
      gatewayValidation,
    );

    expect(errors.some((error) => error.property === "ownerTribeId")).toBe(true);
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

  it("rejects invalid projectId values", async () => {
    const errors = await validate(transform({ ...baseManifest, projectId: "Demand Planning!" }));

    expect(errors.some((error) => error.property === "projectId")).toBe(true);
  });
});
