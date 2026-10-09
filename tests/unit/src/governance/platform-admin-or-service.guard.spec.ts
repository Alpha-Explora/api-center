import { PlatformAdminOrServiceGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/platform-admin-or-service.guard";

describe("PlatformAdminOrServiceGuard", () => {
  const contextFor = (request: object) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;

  it("marks a valid platform-secret request as platform admin", async () => {
    const request = { headers: { "x-platform-secret": "valid" } };
    const jwt = { canActivate: jest.fn() };
    const admin = { canActivate: jest.fn().mockResolvedValue(true) };
    const guard = new PlatformAdminOrServiceGuard(jwt as never, admin as never);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request).toHaveProperty("platformAdmin", true);
    expect(jwt.canActivate).not.toHaveBeenCalled();
  });

  it("falls back to a normal service JWT when the platform-secret path is absent", async () => {
    const request = { headers: {} };
    const jwt = { canActivate: jest.fn().mockResolvedValue(true) };
    const admin = { canActivate: jest.fn() };
    const guard = new PlatformAdminOrServiceGuard(jwt as never, admin as never);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(jwt.canActivate).toHaveBeenCalled();
    expect(request).not.toHaveProperty("platformAdmin");
  });
});
