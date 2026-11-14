#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createReport, finalize } = require("./release-report.cjs");
const { runConsumerChecks } = require("./consumer-checks.cjs");
const { observeDeployment } = require("./deployment-identity.cjs");
const { submitEvidence } = require("./submit-evidence.cjs");
const { z } = require("zod");

const repositoryChecks = [
  ["boundaries", ["run", "check:boundaries"]],
  ["monorepo", ["run", "check:monorepo"]],
  ["typecheck", ["run", "typecheck"]],
  ["tests", ["run", "test:all"]],
  ["release-runner", ["run", "test:release-verification"]],
  ["contracts", ["run", "contracts:validate"]],
  ["documentation", ["run", "check:documentation"]],
  ["documentation-tests", ["run", "test:documentation"]],
  ["build", ["run", "build"]],
  ["docs-tests", ["run", "docs:test"]],
];
function runNpm(args) {
  const npm =
    process.env.npm_execpath ||
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    );
  execFileSync(process.execPath, [npm, ...args], {
    stdio: "inherit",
    timeout: 900_000,
    windowsHide: true,
  });
}
async function verify({
  phase = "repository",
  environment = "test",
  expectedCommit,
  dirty,
  execute = runNpm,
  consumer,
  deployments = [],
  claimedRun,
}) {
  const report = createReport({
    commit: expectedCommit,
    dirty,
    environment,
    phase,
  });
  if (claimedRun) report.runId = claimedRun.runId;
  if (phase !== "deployed")
    for (const [checkId, args] of repositoryChecks) {
      try {
        await execute(args);
        report.checks.push({
          checkId: "repository." + checkId,
          status: "passed",
          required: true,
        });
      } catch {
        report.checks.push({
          checkId: "repository." + checkId,
          status: "failed",
          required: true,
          errorCode: "CHECK_FAILED",
        });
      }
    }
  if (phase !== "repository") {
    if (!deployments.length)
      report.checks.push({
        checkId: "deployment.identity",
        status: "blocked",
        required: true,
        errorCode: "DEPLOYMENT_IDENTITY_MISSING",
      });
    for (const target of deployments) {
      try {
        const observed = await observeDeployment(target);
        const targetCommit =
          target.serviceId === consumer?.serviceId
            ? (target.expectedCommit ?? expectedCommit)
            : expectedCommit;
        report.deployments.push(observed);
        report.checks.push({
          checkId: "deployment." + target.service,
          status: observed.commit === targetCommit ? "passed" : "failed",
          required: true,
          ...(observed.commit !== targetCommit
            ? { errorCode: "REVISION_MISMATCH" }
            : {}),
        });
      } catch {
        report.checks.push({
          checkId: "deployment." + target.service,
          status: "blocked",
          required: true,
          errorCode: "DEPLOYMENT_IDENTITY_MISSING",
        });
      }
    }
    const gateway = report.deployments.find(
      (item) => item.serviceId === "gateway",
    );
    const target = report.deployments.find(
      (item) => item.serviceId === consumer?.serviceId,
    );
    const identityReady = Boolean(
      gateway &&
      target &&
      report.checks
        .filter((item) => item.checkId.startsWith("deployment."))
        .every((item) => item.status === "passed"),
    );
    if (deployments.length && !identityReady)
      report.checks.push({
        checkId: "deployment.context",
        status: "blocked",
        required: true,
        errorCode: "DEPLOYMENT_IDENTITY_MISSING",
      });
    if (consumer)
      report.checks.push(
        ...(await runConsumerChecks(consumer, {
          runId: report.runId,
          deployments: identityReady ? report.deployments : [],
          requiredChecks: claimedRun?.requiredChecks,
          providerCasesAuthorized: Boolean(claimedRun),
        })),
      );
    else
      report.checks.push({
        checkId: "authentication",
        status: "blocked",
        required: true,
        errorCode: "CONSUMER_CREDENTIALS_REQUIRED",
      });
  }
  return finalize(report);
}
async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const phase = z
    .enum(["repository", "deployed", "all"])
    .parse(option("--phase") || "repository");
  const environment = z
    .enum(["test", "live"])
    .parse(option("--environment") || "test");
  const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
  const destination = path.resolve(
    option("--output") || "artifacts/release-verification.json",
  );
  // Reserve the artifact before any provider operation. A crash leaves an explicit investigation record.
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    JSON.stringify(
      {
        status: "interrupted-until-completed",
        environment,
        phase,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  const env = process.env;
  const consumer =
    env.APICENTER_URL &&
    env.APICENTER_SERVICE_ID &&
    env.APICENTER_SERVICE_SECRET
      ? {
          baseUrl: env.APICENTER_URL,
          serviceId: env.APICENTER_SERVICE_ID,
          secret: env.APICENTER_SERVICE_SECRET,
          environment,
        }
      : undefined;
  let claimedRun;
  if (
    args.includes("--submit") &&
    consumer &&
    !dirty &&
    phase !== "repository"
  ) {
    try {
      if (!env.APICENTER_VERIFICATION_RUNNER_TOKEN)
        throw new Error("VERIFICATION_RUNNER_REQUIRED");
      const response = await fetch(
        new URL(
          "/api/v1/admin/operations/verification/claim",
          consumer.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.APICENTER_VERIFICATION_RUNNER_TOKEN,
          },
          body: JSON.stringify({
            serviceId: consumer.serviceId,
            environment,
            ...(option("--run-id") ? { runId: option("--run-id") } : {}),
          }),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error("VERIFICATION_CLAIM_FAILED");
      const result = await response.json();
      claimedRun = z
        .object({
          runId: z.string().uuid(),
          configurationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          gatewayRevision: z.string().regex(/^[a-f0-9]{40}$/),
          deploymentRevision: z.string().min(1),
          requiredChecks: z.array(z.string()),
        })
        .parse(result.data);
    } catch {
      claimedRun = undefined;
    }
  }
  if (claimedRun)
    fs.writeFileSync(
      destination,
      JSON.stringify(
        {
          status: "running",
          environment,
          phase,
          serviceId: consumer.serviceId,
          commit: expectedCommit,
          ...claimedRun,
        },
        null,
        2,
      ) + "\n",
    );
  let report;
  try {
    report = await verify({
      phase,
      environment,
      expectedCommit,
      dirty,
      consumer: args.includes("--submit") && !claimedRun ? undefined : consumer,
      deployments: JSON.parse(env.APICENTER_VERIFY_DEPLOYMENTS || "[]"),
      claimedRun,
    });
  } catch {
    report = finalize({
      ...createReport({ commit: expectedCommit, dirty, environment, phase }),
      checks: [
        {
          checkId: "configuration",
          status: "failed",
          required: true,
          errorCode: "INVALID_VERIFICATION_CONFIGURATION",
        },
      ],
    });
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  if (args.includes("--submit")) {
    try {
      const gateway = report.deployments.find(
        (item) => item.serviceId === "gateway",
      );
      const target = report.deployments.find(
        (item) => item.serviceId === consumer?.serviceId,
      );
      if (
        !gateway ||
        !target ||
        !consumer ||
        !claimedRun ||
        dirty ||
        gateway.commit !== claimedRun.gatewayRevision ||
        target.revision !== claimedRun.deploymentRevision
      )
        throw new Error("DEPLOYMENT_IDENTITY_MISSING");
      const runtime = report.checks
        .filter(
          (check) =>
            !check.checkId.startsWith("repository.") &&
            !check.checkId.startsWith("deployment."),
        )
        .map(({ checkId, status, errorCode }) => ({
          checkId,
          status,
          ...(errorCode ? { errorCode } : {}),
        }));
      await submitEvidence({
        baseUrl: consumer.baseUrl,
        runnerToken: env.APICENTER_VERIFICATION_RUNNER_TOKEN,
        report: {
          version: 1,
          runId: claimedRun.runId,
          serviceId: consumer.serviceId,
          environment,
          configurationFingerprint: claimedRun.configurationFingerprint,
          gatewayRevision: gateway.commit,
          deploymentRevision: target.revision,
          ciRunId: env.GITHUB_RUN_ID || report.runId,
          observedAt: report.finishedAt,
          checks: runtime,
        },
      });
    } catch {
      report.checks.push({
        checkId: "evidence.submission",
        status: "failed",
        required: true,
        errorCode: "EVIDENCE_SUBMISSION_FAILED",
      });
      report = finalize(report);
      fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
    }
  }
  console.log(
    JSON.stringify({
      artifact: destination,
      releasable: report.releasable,
      status: report.releasable ? "Verified release" : "Not releasable",
      passed: report.checks.filter((check) => check.status === "passed").length,
      failed: report.checks.filter((check) => check.status === "failed").length,
      blocked: report.checks.filter((check) => check.status === "blocked")
        .length,
    }),
  );
  process.exitCode =
    report.checks.some(
      (check) => check.required && check.status !== "passed",
    ) || report.dirty
      ? 1
      : 0;
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Release verification failed before a report could be written",
    );
    process.exitCode = 1;
  });
module.exports = { verify, repositoryChecks };
