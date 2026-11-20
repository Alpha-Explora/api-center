// Maps database failures to the response a caller can act on. Pool exhaustion and lost
// connections are temporary (503 with Retry-After); unique and missing-record violations are the
// caller's conflict or a vanished resource, not a server bug.

export interface MappedDatabaseError {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

/** Prisma codes for a busy or unreachable database. P2028: no transaction slot within maxWait. */
const BUSY_CODES = new Set(["P2024", "P2028", "P2034"]);
const UNREACHABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);
/** node-postgres and socket failures that reach us without a Prisma code. */
const CONNECTION_FAILURE = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection terminated|timeout exceeded when trying to connect/i;

export function mapDatabaseError(error: unknown): MappedDatabaseError | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
  const isPrisma = typeof name === "string" && name.startsWith("PrismaClient");
  const prismaCode = isPrisma && typeof code === "string" ? code : undefined;

  if ((prismaCode && BUSY_CODES.has(prismaCode)) || (isPrisma && /Unable to start a transaction/i.test(String(message)))) {
    return { status: 503, code: "DATABASE_BUSY", message: "APICenter is busy. Retry shortly.", retryAfterSeconds: 2 };
  }
  if ((prismaCode && UNREACHABLE_CODES.has(prismaCode)) || name === "PrismaClientInitializationError" || (isPrisma && CONNECTION_FAILURE.test(String(message)))) {
    return { status: 503, code: "DATABASE_UNAVAILABLE", message: "APICenter cannot reach its database. Retry shortly.", retryAfterSeconds: 5 };
  }
  if (prismaCode === "P2002") return { status: 409, code: "CONFLICT", message: "A record with these values already exists" };
  if (prismaCode === "P2025") return { status: 404, code: "NOT_FOUND", message: "The record was not found" };
  return undefined;
}
