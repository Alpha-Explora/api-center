import { validate } from "class-validator";
import { TokenRequestDto } from "./token-request.dto";

const dto = (input: Partial<TokenRequestDto>) =>
  Object.assign(new TokenRequestDto(), input);

describe("TokenRequestDto", () => {
  it("allows missing environment so rollout warn mode can map legacy clients", async () => {
    const errors = await validate(
      dto({ tribeId: "church-donations", secret: "secret" }),
    );

    expect(errors.some((error) => error.property === "environment")).toBe(
      false,
    );
  });

  it.each(["test", "live"])("accepts %s", async (environment) => {
    await expect(
      validate(
        dto({
          tribeId: "church-donations",
          sourceServiceId: "church-donations",
          secret: "secret",
          environment,
        } as Partial<TokenRequestDto>),
      ),
    ).resolves.toHaveLength(0);
  });

  it("rejects production", async () => {
    const errors = await validate(
      dto({
        tribeId: "church-donations",
        secret: "secret",
        environment: "production",
      } as unknown as Partial<TokenRequestDto>),
    );

    expect(errors.some((error) => error.property === "environment")).toBe(true);
  });
});
