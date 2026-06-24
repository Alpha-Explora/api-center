import { Reflector } from "@nestjs/core";
import { TribeThrottlerGuard } from "./tribe-throttler.guard";
import { AuthService } from "../../auth/auth.service";

class TestTribeThrottlerGuard extends TribeThrottlerGuard {
  resolveTracker(req: Record<string, any>): Promise<string> {
    return this.getTracker(req);
  }
}

describe("TribeThrottlerGuard", () => {
  const auth = {
    validateToken: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;

  let guard: TestTribeThrottlerGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new TestTribeThrottlerGuard(
      [{ ttl: 60000, limit: 100 }],
      {} as any,
      new Reflector(),
      auth,
    );
  });

  it("uses the already-verified request tribe when present", async () => {
    await expect(
      guard.resolveTracker({
        user: { tribeId: "payments" },
        ip: "127.0.0.1",
      }),
    ).resolves.toBe("tribe:payments");
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it("validates bearer tokens before falling back to IP", async () => {
    auth.validateToken.mockResolvedValueOnce({
      sub: "svc-payments",
      tribeId: "payments",
    });

    await expect(
      guard.resolveTracker({
        headers: { authorization: "Bearer valid-token" },
        ip: "127.0.0.1",
      }),
    ).resolves.toBe("tribe:payments");
    expect(auth.validateToken).toHaveBeenCalledWith("valid-token");
  });

  it("uses the verified token subject when no tribe claim exists", async () => {
    auth.validateToken.mockResolvedValueOnce({ sub: "svc-without-tribe" });

    await expect(
      guard.resolveTracker({
        headers: { authorization: "Bearer valid-token" },
        ip: "127.0.0.1",
      }),
    ).resolves.toBe("subject:svc-without-tribe");
  });

  it("falls back to IP for invalid bearer tokens", async () => {
    auth.validateToken.mockRejectedValueOnce(new Error("invalid"));

    await expect(
      guard.resolveTracker({
        headers: { authorization: "Bearer invalid-token" },
        ip: "127.0.0.1",
      }),
    ).resolves.toBe("127.0.0.1");
  });
});
