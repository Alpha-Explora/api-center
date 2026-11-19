import { ExecutionContext } from "@nestjs/common";
import { ScopedAdminGuard } from "../../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import type { ConfigService } from "../../../../../apps/gateway/src/config/config.service";
import { UnauthorizedError } from "../../../../../apps/gateway/src/shared/errors";

const context = (headers: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

describe("ScopedAdminGuard", () => {
  const guard = new ScopedAdminGuard({ platformAdminSecret: "test-secret-123" } as ConfigService);

  it("admits the platform credential", () => {
    expect(guard.canActivate(context({ "x-platform-secret": "test-secret-123" }))).toBe(true);
  });

  it("refuses a wrong, missing or bearer credential", () => {
    const attempts: Array<Record<string, string>> = [{ "x-platform-secret": "test-secret-124" }, { "x-platform-secret": "test" }, {}, { authorization: "Bearer test-secret-123" }];
    for (const headers of attempts) {
      expect(() => guard.canActivate(context(headers))).toThrow(UnauthorizedError);
    }
  });

  it("refuses everyone when no platform credential is configured", () => {
    const unset = new ScopedAdminGuard({ platformAdminSecret: "" } as ConfigService);
    expect(() => unset.canActivate(context({ "x-platform-secret": "" }))).toThrow(UnauthorizedError);
  });
});
