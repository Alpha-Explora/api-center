import { ConfigService } from "../../config/config.service";
import { buildExternalApis } from "./index";

describe("external api builders", () => {
  const config = {} as unknown as ConfigService;

  it("should not register geo APIs as external APIs", () => {
    const apis = buildExternalApis(config);

    expect(apis).toEqual({});
  });
});
