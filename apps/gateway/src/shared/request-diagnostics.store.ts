import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { z } from "zod";

export const diagnosticQuery = z
  .object({
    serviceId: z
      .string()
      .regex(/^[a-z0-9-]{1,150}$/)
      .optional(),
    environment: z.enum(["test", "live", "unattributed"]),
    correlationId: z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,128}$/)
      .optional(),
    from: z.string().datetime(),
    to: z.string().datetime(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (input) =>
      Date.parse(input.to) > Date.parse(input.from) &&
      Date.parse(input.to) - Date.parse(input.from) <= 7 * 86_400_000,
    "Time window must be between zero and seven days",
  );
export type DiagnosticRecord = {
  requestId: string;
  correlationId: string;
  serviceId: string | null;
  projectId: string | null;
  environment: string | null;
  route: string;
  method: string;
  statusCode: number;
  errorCode: string | null;
  paymentResourceId: string | null;
  failureStage: string | null;
  durationMs: number;
};

@Injectable()
export class RequestDiagnosticsStore {
  constructor(private readonly prisma: PrismaService) {}
  async record(record: DiagnosticRecord): Promise<void> {
    if (process.env.DATABASE_ENABLED !== "true") return;
    await this.prisma.$executeRawUnsafe(
      "INSERT INTO apic_runtime.request_diagnostics (request_id,correlation_id,service_id,project_id,environment,route,method,status_code,error_code,failure_stage,duration_ms,payment_resource_id) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      record.requestId,
      record.correlationId,
      record.serviceId,
      record.projectId,
      record.environment,
      record.route,
      record.method,
      record.statusCode,
      record.errorCode,
      record.failureStage,
      record.durationMs,
      record.paymentResourceId,
    );
  }
  async list(query: z.infer<typeof diagnosticQuery>) {
    return this.prisma.$queryRawUnsafe<
      Array<{
        requestId: string;
        correlationId: string;
        serviceId: string | null;
        environment: string | null;
        route: string;
        method: string;
        statusCode: number;
        errorCode: string | null;
        paymentResourceId: string | null;
        failureStage: string | null;
        durationMs: number;
        occurredAt: Date;
      }>
    >(
      'SELECT request_id AS "requestId",correlation_id AS "correlationId",service_id AS "serviceId",environment,route,method,status_code AS "statusCode",error_code AS "errorCode",payment_resource_id AS "paymentResourceId",failure_stage AS "failureStage",duration_ms AS "durationMs",created_at AS "occurredAt" FROM apic_runtime.request_diagnostics WHERE (environment=$1 OR ($1=\'unattributed\' AND environment IS NULL)) AND ($2::text IS NULL OR service_id=$2) AND ($3::text IS NULL OR correlation_id=$3) AND created_at >= $4::timestamptz AND created_at <= $5::timestamptz ORDER BY created_at DESC,request_id DESC LIMIT $6 OFFSET $7',
      query.environment,
      query.serviceId ?? null,
      query.correlationId ?? null,
      query.from,
      query.to,
      query.limit,
      query.offset,
    );
  }

  /** One project environment's requests, newest first, keyset-paginated. Never bodies or query strings. */
  async listForProject(filter: {
    projectId: string;
    environment: "test" | "live";
    applicationId?: string;
    statusRange: [number, number];
    from: Date;
    to: Date;
    /** Rows strictly older than this one; `at` is the microsecond text from `cursorAt`. */
    before?: { at: string; id: string };
    take: number;
  }) {
    return this.prisma.$queryRaw<ProjectRequestRow[]>`
      SELECT request_id::text AS "requestId", created_at AS "occurredAt",
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
             service_id AS "applicationId", method, route,
             status_code AS "statusCode", duration_ms AS "durationMs", failure_stage AS "failureStage",
             error_code AS "errorCode", correlation_id AS "correlationId"
      FROM apic_runtime.request_diagnostics
      WHERE project_id = ${filter.projectId}
        AND environment = ${filter.environment}
        AND (${filter.applicationId ?? null}::text IS NULL OR service_id = ${filter.applicationId ?? null})
        AND status_code BETWEEN ${filter.statusRange[0]} AND ${filter.statusRange[1]}
        AND created_at >= ${filter.from} AND created_at <= ${filter.to}
        AND (${filter.before?.at ?? null}::timestamptz IS NULL
             OR (created_at, request_id) < (${filter.before?.at ?? null}::timestamptz, ${filter.before?.id ?? null}::uuid))
      ORDER BY created_at DESC, request_id DESC
      LIMIT ${filter.take}`;
  }
}

export interface ProjectRequestRow {
  requestId: string;
  occurredAt: Date;
  /** created_at at full (microsecond) precision, for the next page's cursor. */
  cursorAt: string;
  applicationId: string | null;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  failureStage: string | null;
  errorCode: string | null;
  correlationId: string;
}
