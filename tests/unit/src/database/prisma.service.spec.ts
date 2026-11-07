import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";

describe("PrismaService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POOL_MAX;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each(["0", "-1", "1.5", "not-a-number", "Infinity", "9007199254740992", ""])(
    "rejects invalid database pool limit %s before connecting",
    (value) => {
      process.env.DATABASE_POOL_MAX = value;
      expect(() => new PrismaService()).toThrow("DATABASE_POOL_MAX must be a positive integer");
    },
  );

  it.each(["1", "2", "8"])("accepts positive database pool limit %s", (value) => {
    process.env.DATABASE_POOL_MAX = value;
    expect(() => new PrismaService()).not.toThrow();
  });

  it("does not connect when the database feature flag is off", async () => {
    const service = new PrismaService();
    const connect = jest
      .spyOn(service, "$connect")
      .mockResolvedValue(undefined);
    const disconnect = jest
      .spyOn(service, "$disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("connects and disconnects through lifecycle hooks when enabled", async () => {
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL =
      "postgresql://api_center_app:password@localhost:5432/api_center";

    const service = new PrismaService();
    const connect = jest
      .spyOn(service, "$connect")
      .mockResolvedValue(undefined);
    const disconnect = jest
      .spyOn(service, "$disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
