import { PrismaService } from "../../../../src/database/prisma.service";

describe("PrismaService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
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
