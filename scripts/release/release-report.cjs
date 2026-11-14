const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const check = z
  .object({
    checkId: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
    status: z.enum(["passed", "failed", "skipped", "blocked"]),
    required: z.boolean(),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .optional(),
  })
  .strict();
const releaseReport = z
  .object({
    version: z.literal(1),
    runId: z.string().uuid(),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    dirty: z.boolean(),
    environment: z.enum(["test", "live"]),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    phase: z.enum(["repository", "deployed", "all"]),
    checks: z.array(check),
    deployments: z.array(
      z.object({
        service: z.string(),
        serviceId: z.string().optional(),
        revision: z.string(),
        commit: z.string(),
        imageDigest: z.string(),
        production: z.boolean().optional(),
      }),
    ),
    releasable: z.boolean(),
  })
  .strict();
function createReport({
  commit,
  dirty,
  environment,
  phase,
  startedAt = new Date().toISOString(),
}) {
  return {
    version: 1,
    runId: randomUUID(),
    commit,
    dirty,
    environment,
    phase,
    startedAt,
    finishedAt: startedAt,
    checks: [],
    deployments: [],
    releasable: false,
  };
}
function finalize(report) {
  const required = report.checks.filter((check) => check.required);
  report.finishedAt = new Date().toISOString();
  report.releasable =
    !report.dirty &&
    report.phase === "all" &&
    report.deployments.length > 0 &&
    required.length > 0 &&
    required.every((check) => check.status === "passed");
  return releaseReport.parse(report);
}
module.exports = { createReport, finalize, releaseReport };
