import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly enabled =
    process.env.DATABASE_ENABLED === "true" || Boolean(process.env.DATABASE_URL);

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://api_center_app:password@localhost:5432/api_center";
    // Session-pooler connections are shared across Cloud Run instances and rollout revisions.
    const poolMax = Number(process.env.DATABASE_POOL_MAX ?? "2");
    if (!Number.isSafeInteger(poolMax) || poolMax < 1) {
      throw new Error("DATABASE_POOL_MAX must be a positive integer");
    }

    super({
      adapter: new PrismaPg({ connectionString, max: poolMax }),
    });
  }

  async onModuleInit() {
    if (!this.enabled) {
      return;
    }

    await this.$connect();
  }

  async onModuleDestroy() {
    if (!this.enabled) {
      return;
    }

    await this.$disconnect();
  }
}
