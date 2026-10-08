import { validate } from "class-validator";
import { TokenRequestDto } from "../../../../../apps/gateway/src/shared/dto/token-request.dto";

const dto = (input: Record<string, unknown>) =>
  Object.assign(new TokenRequestDto(), input);

const gatewayValidation = { whitelist: true, forbidNonWhitelisted: true };

describe("TokenRequestDto", () => {
  it("rejects missing environment", async () => {
    const errors = await validate(dto({ serviceId: "donations-api", secret: "secret" }));

    expect(errors.some((error) => error.property === "environment")).toBe(true);
  });

  it.each(["test", "live"])("accepts %s", async (environment) => {
    await expect(
      validate(dto({ serviceId: "donations-api", secret: "secret", environment }), gatewayValidation),
    ).resolves.toHaveLength(0);
  });

  it("rejects production", async () => {
    const errors = await validate(
      dto({ serviceId: "donations-api", secret: "secret", environment: "production" }),
    );

    expect(errors.some((error) => error.property === "environment")).toBe(true);
  });

  it("requires a lowercase serviceId", async () => {
    const missing = await validate(dto({ secret: "secret", environment: "test" }));
    const invalid = await validate(dto({ serviceId: "Donations API", secret: "secret", environment: "test" }));

    expect(missing.some((error) => error.property === "serviceId")).toBe(true);
    expect(invalid.some((error) => error.property === "serviceId")).toBe(true);
  });

  it("rejects caller-chosen tribe or source service: identity comes from the credential", async () => {
    const errors = await validate(
      dto({
        serviceId: "donations-api",
        tribeId: "church",
        sourceServiceId: "other-service",
        secret: "secret",
        environment: "test",
      }),
      gatewayValidation,
    );

    expect(errors.map((error) => error.property).sort()).toEqual(["sourceServiceId", "tribeId"]);
  });
});
