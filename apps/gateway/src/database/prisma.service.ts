import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly enabled = process.env.DATABASE_ENABLED === "true";

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://api_center_app:password@localhost:5432/api_center";

    super({
      adapter: new PrismaPg({ connectionString }),
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
