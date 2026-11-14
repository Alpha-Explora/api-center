import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "@database/prisma.service";
import { RegistryService } from "@registry/registry.service";
import {
  VerificationReport,
  configurationFingerprint,
  summarizeVerification,
} from "./verification-evidence.schema";
import {
  PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY,
  type PaymentCredentialEvidenceDirectory,
} from "../../payments/features/consumer-management/payment-consumer.types";
import { RuntimeDeploymentObserver } from "./runtime-deployment-observer.service";

const RunnerAssignments = z.array(
  z
    .object({
      subject: z.string().min(1),
      serviceIds: z.array(z.string()).min(1),
      environments: z.array(z.enum(["test", "live"])).min(1),
    })
    .strict(),
);
type Runner = {
  subject: string;
  environment: string | undefined;
  scopes: string[];
};
const runInput = z
  .object({
    serviceId: z.string().regex(/^[a-z0-9-]{1,150}$/),
    environment: z.enum(["test", "live"]),
    runId: z.string().uuid().optional(),
  })
  .strict();

@Injectable()
export class VerificationEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    @Inject(PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY)
    private readonly credentials: PaymentCredentialEvidenceDirectory,
    private readonly deployments: RuntimeDeploymentObserver,
  ) {}

  async context(serviceId: string, environment: "test" | "live") {
    const entry = this.registry.get(serviceId);
    if (!entry?.projectId || !entry.ownerTribeId)
      throw new NotFoundException("Registered consumer service required");
    const projectId = entry.projectId;
    if (process.env.DATABASE_ENABLED !== "true")
      throw new ServiceUnavailableException(
        "Durable verification requires the database",
      );
    const dependencies = entry.consumes
      .map(
        (id) =>
          this.registry.get(id === "payments" ? "payment" : id) ??
          this.registry.get(id),
      )
      .filter((item) => item !== null);
    const [versions, secret, runtime] = await Promise.all([
      this.credentials.credentialVersions(serviceId, environment),
      this.registry.credentialMetadata(serviceId, environment),
      this.deployments.observe([entry, ...dependencies], environment),
    ]);
    const gatewayRevision = /^[a-f0-9]{40}$/.test(
      process.env.APICENTER_RELEASE_SHA ?? "",
    )
      ? (process.env.APICENTER_RELEASE_SHA ?? null)
      : null;
    const deploymentRevision =
      runtime.deployments.find((item) => item.serviceId === serviceId)
        ?.revision ?? null;
    const eventDeliveryRequired = versions.some((version) =>
      Boolean(version.event_endpoint_url),
    );
    return {
      entry,
      projectId,
      environment,
      secret,
      eventDeliveryRequired,
      deploymentRevision,
      deploymentKnown:
        runtime.complete && dependencies.length === entry.consumes.length,
      fingerprint: configurationFingerprint(entry, environment, {
        versions,
        secretVersion: secret?.versionName ?? null,
        rotationState: secret?.rotationState ?? null,
        deployments: runtime.deployments,
        dependencyConfiguration: dependencies.map((item) => ({
          serviceId: item.serviceId,
          version: item.version,
          requiredScopes: item.requiredScopes,
          environments: item.environments.map((row) => ({
            environment: row.environment,
            baseUrl: row.baseUrl,
            status: row.status,
          })),
        })),
      }),
      gatewayRevision,
    };
  }

  private authorizeRunner(
    report: { serviceId: string; environment: "test" | "live" },
    runner: Runner,
  ) {
    let assignments: z.infer<typeof RunnerAssignments>;
    try {
      assignments = RunnerAssignments.parse(
        JSON.parse(process.env.APICENTER_VERIFICATION_RUNNERS ?? "[]"),
      );
    } catch {
      throw new ServiceUnavailableException(
        "Verification runner configuration is invalid",
      );
    }
    if (
      !runner.scopes.includes("verification:write") ||
      runner.environment !== report.environment ||
      !assignments.some(
        (assignment) =>
          assignment.subject === runner.subject &&
          assignment.serviceIds.includes(report.serviceId) &&
          assignment.environments.includes(report.environment),
      )
    )
      throw new ForbiddenException(
        "Verification runner is not authorized for this service and environment",
      );
  }

  async requestRun(input: unknown, actor: string) {
    const parsed = runInput.omit({ runId: true }).safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid verification target");
    const context = await this.context(
      parsed.data.serviceId,
      parsed.data.environment,
    );
    if (!context.gatewayRevision || !context.deploymentKnown)
      throw new ServiceUnavailableException(
        "Deployment revision is unavailable",
      );
    await this.interruptExpired(parsed.data.serviceId, parsed.data.environment);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ runId: string; status: string }>
    >(
      "INSERT INTO apic_runtime.verification_runs(service_id,project_id,environment,fingerprint,gateway_revision,requested_by,status) VALUES ($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT DO NOTHING RETURNING run_id AS \"runId\",status",
      parsed.data.serviceId,
      context.projectId,
      parsed.data.environment,
      context.fingerprint,
      context.gatewayRevision,
      actor,
    );
    if (!rows[0])
      throw new ConflictException(
        "Verification is queued, running, or requires reconciliation",
      );
    return rows[0];
  }

  async claim(input: unknown, runner: Runner) {
    const parsed = runInput.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid verification target");
    const target = parsed.data;
    this.authorizeRunner(target, runner);
    const context = await this.context(target.serviceId, target.environment);
    await this.interruptExpired(target.serviceId, target.environment);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        runId: string;
        configurationFingerprint: string;
        gatewayRevision: string;
      }>
    >(
      'WITH candidate AS (SELECT run_id FROM apic_runtime.verification_runs WHERE service_id=$1 AND environment=$2 AND status=\'queued\' AND fingerprint=$3 AND gateway_revision=$4 AND ($6::uuid IS NULL OR run_id=$6::uuid) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE apic_runtime.verification_runs r SET status=\'running\',claimed_by=$5,updated_at=now() FROM candidate WHERE r.run_id=candidate.run_id RETURNING r.run_id AS "runId",r.fingerprint AS "configurationFingerprint",r.gateway_revision AS "gatewayRevision"',
      target.serviceId,
      target.environment,
      context.fingerprint,
      context.gatewayRevision,
      runner.subject,
      target.runId ?? null,
    );
    if (!rows[0])
      throw new ConflictException(
        "No current queued verification run is available; request a run for the current configuration",
      );
    return {
      ...rows[0],
      deploymentRevision: context.deploymentRevision,
      requiredChecks: summarizeVerification({
        ...context,
        report: null,
      }).checks.map((check) => check.checkId),
    };
  }

  private async interruptExpired(
    serviceId: string,
    environment: "test" | "live",
  ) {
    await this.prisma.$executeRawUnsafe(
      "UPDATE apic_runtime.verification_runs SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'interrupted' END,updated_at=now() WHERE service_id=$1 AND environment=$2 AND status IN ('queued','running') AND updated_at < now()-interval '30 minutes'",
      serviceId,
      environment,
    );
  }

  async reconcile(input: unknown, actor: string) {
    const parsed = runInput
      .required({ runId: true })
      .extend({ reason: z.string().trim().min(10).max(500) })
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        "Run identity and a reconciliation reason are required",
      );
    const { serviceId, environment, runId, reason } = parsed.data;
    await this.context(serviceId, environment);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ runId: string; status: string }>
    >(
      "UPDATE apic_runtime.verification_runs SET status='failed',reconciled_by=$4,reconciliation_reason=$5,reconciled_at=now(),updated_at=now() WHERE run_id=$1::uuid AND service_id=$2 AND environment=$3 AND status='uncertain' RETURNING run_id AS \"runId\",status",
      runId,
      serviceId,
      environment,
      actor,
      reason,
    );
    if (!rows[0])
      throw new ConflictException("An uncertain verification run is required");
    return rows[0];
  }

  async record(input: unknown, runner: Runner) {
    const parsed = VerificationReport.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid verification report");
    const report = parsed.data;
    this.authorizeRunner(report, runner);
    const context = await this.context(report.serviceId, report.environment);
    const serviceRowId = await this.registry.resolveStorageId(
      report.serviceId,
      context.projectId,
    );
    if (!serviceRowId)
      throw new NotFoundException("Persisted service placement required");
    const age = Date.now() - Date.parse(report.observedAt);
    if (
      age < 0 ||
      age >= 86_400_000 ||
      !context.gatewayRevision ||
      !context.deploymentKnown ||
      report.deploymentRevision !== context.deploymentRevision ||
      report.gatewayRevision !== context.gatewayRevision ||
      report.configurationFingerprint !== context.fingerprint
    ) {
      throw new BadRequestException(
        "Verification context is stale or does not match the deployment",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const runs = await transaction.$queryRawUnsafe<Array<{ status: string }>>(
        "SELECT status FROM apic_runtime.verification_runs WHERE run_id=$1::uuid AND service_id=$2 AND environment=$3 AND claimed_by=$4 AND status IN ('running','passed','failed','uncertain') AND fingerprint=$5 AND gateway_revision=$6 FOR UPDATE",
        report.runId,
        report.serviceId,
        report.environment,
        runner.subject,
        report.configurationFingerprint,
        report.gatewayRevision,
      );
      if (!runs[0])
        throw new ConflictException("A claimed verification run is required");
      const rows = await transaction.$queryRawUnsafe<
        Array<{ report: unknown; runner: string }>
      >(
        "INSERT INTO apic_runtime.verification_reports (run_id,service_row_id,service_id,project_id,environment,runner,observed_at,report) VALUES ($1::uuid,$8::uuid,$2,$3,$4,$5,$6::timestamptz,$7::jsonb) ON CONFLICT (run_id) DO NOTHING RETURNING report,runner",
        report.runId,
        report.serviceId,
        context.entry.projectId,
        report.environment,
        runner.subject,
        report.observedAt,
        JSON.stringify(report),
        serviceRowId,
      );
      if (!rows.length) {
        const previous = await transaction.$queryRawUnsafe<
          Array<{ report: unknown; runner: string }>
        >(
          "SELECT report,runner FROM apic_runtime.verification_reports WHERE run_id=$1::uuid",
          report.runId,
        );
        if (
          previous[0]?.runner !== runner.subject ||
          JSON.stringify(previous[0]?.report) !== JSON.stringify(report)
        ) {
          // PostgreSQL jsonb normalizes object key order; compare parsed semantic fields instead below.
          const prior = VerificationReport.safeParse(previous[0]?.report);
          if (
            previous[0]?.runner !== runner.subject ||
            !prior.success ||
            JSON.stringify(prior.data) !== JSON.stringify(report)
          )
            throw new BadRequestException(
              "Verification run ID was already used for different evidence",
            );
        }
      }
      const summary = summarizeVerification({ ...context, report });
      const uncertain = report.checks.some(
        (check) => check.errorCode === "PROVIDER_OUTCOME_UNKNOWN",
      );
      if (uncertain) summary.ready = false;
      if (rows.length)
        await transaction.$executeRawUnsafe(
          "UPDATE apic_runtime.verification_runs SET status=$2,updated_at=now() WHERE run_id=$1::uuid AND claimed_by=$3",
          report.runId,
          uncertain ? "uncertain" : summary.ready ? "passed" : "failed",
          runner.subject,
        );
      return summary;
    });
  }

  async latest(serviceId: string, environment: "test" | "live") {
    const context = await this.context(serviceId, environment);
    await this.interruptExpired(serviceId, environment);
    const runs = await this.prisma.$queryRawUnsafe<
      Array<{ runId: string; status: string; updatedAt: Date }>
    >(
      'SELECT run_id AS "runId",status,updated_at AS "updatedAt" FROM apic_runtime.verification_runs WHERE service_id=$1 AND environment=$2 ORDER BY created_at DESC LIMIT 1',
      serviceId,
      environment,
    );
    const rows = await this.prisma.$queryRawUnsafe<Array<{ report: unknown }>>(
      "SELECT report FROM apic_runtime.verification_reports WHERE service_id=$1 AND project_id=$2 AND environment=$3 ORDER BY observed_at DESC,run_id DESC LIMIT 1",
      serviceId,
      context.entry.projectId,
      environment,
    );
    const parsed = VerificationReport.safeParse(rows[0]?.report);
    const current =
      parsed.success &&
      runs[0]?.runId === parsed.data.runId &&
      ["passed", "failed", "uncertain"].includes(runs[0].status)
        ? parsed.data
        : null;
    const summary = summarizeVerification({ ...context, report: current });
    if (runs[0]?.status !== "passed") summary.ready = false;
    return {
      ...summary,
      secret: context.secret,
      run: runs[0] ?? null,
    };
  }
}
