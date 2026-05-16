import "dotenv/config";
import Redis from "ioredis";
import { PrismaService } from "../src/database/prisma.service";
import { PostgresRegistryStoreService } from "../src/registry/postgres-registry-store.service";
import { ServiceRegistryEntry } from "../src/types";

const REDIS_REGISTRY_KEY = "api-center:registry:services";

async function main() {
  const redisUrl = process.env.REDIS_CACHE_URL;
  if (!redisUrl) {
    throw new Error("REDIS_CACHE_URL is required");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  process.env.DATABASE_ENABLED = "true";

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  const prisma = new PrismaService();
  const store = new PostgresRegistryStoreService(prisma);

  try {
    await redis.connect();
    await prisma.$connect();

    const rawEntries = await redis.hgetall(REDIS_REGISTRY_KEY);
    let count = 0;

    for (const [serviceId, json] of Object.entries(rawEntries)) {
      const entry = parseRegistryEntry(serviceId, json);
      await store.upsert(entry);
      count++;
    }

    console.log(`Backfilled registry services: ${count}`);
  } finally {
    await redis.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

function parseRegistryEntry(
  serviceId: string,
  json: string,
): ServiceRegistryEntry {
  try {
    return JSON.parse(json) as ServiceRegistryEntry;
  } catch (error) {
    throw new Error(
      `Failed to parse Redis registry entry '${serviceId}': ${(error as Error).message}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
