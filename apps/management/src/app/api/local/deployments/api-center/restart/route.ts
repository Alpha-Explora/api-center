import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createOperationPreview } from "@/lib/operation-preview";
import { getManagementAuthConfig } from "@/lib/server/management-auth";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

const execFileAsync = promisify(execFile);
const DEFAULT_NAMESPACE = "api-center";
const DEFAULT_DEPLOYMENT = "api-center";

export async function POST(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  if (process.env.ALLOW_DEPLOYMENT_RESTARTS !== "true") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Deployment restarts are disabled. Set ALLOW_DEPLOYMENT_RESTARTS=true locally to enable this action.",
      },
      { status: 403 },
    );
  }

  const namespace = process.env.K8S_NAMESPACE || DEFAULT_NAMESPACE;
  const deployment = process.env.K8S_API_CENTER_DEPLOYMENT || DEFAULT_DEPLOYMENT;
  const body = await safeJson(request);
  const environment = getManagementAuthConfig().environment;

  if (isPreviewRequest(body)) {
    await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });

    return NextResponse.json({
      preview: createOperationPreview({
        actionId: "deployment.api-center.restart",
        environment,
        risk: "destructive",
        changes: [
          `Run kubectl rollout restart deployment/${deployment} in namespace ${namespace}`,
          "Wait for rollout status with a 5 minute timeout",
          "Read deployment revision after restart",
        ],
      }),
    });
  }

  const session = await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });
  await requireManagementAction({
    session,
    environment,
    actionRisk: "destructive",
    actionId: "deployment.api-center.restart",
    typedPhrase: body.confirmation?.typedPhrase,
    reason: body.confirmation?.reason,
  });

  const deploymentRef = `deployment/${deployment}`;
  const restartedAt = new Date().toISOString();

  const restart = await runKubectl([
    "-n",
    namespace,
    "rollout",
    "restart",
    deploymentRef,
  ]);
  const status = await runKubectl([
    "-n",
    namespace,
    "rollout",
    "status",
    deploymentRef,
    "--timeout=5m",
  ]);
  const deploymentJson = await runKubectl([
    "-n",
    namespace,
    "get",
    "deployment",
    deployment,
    "-o",
    "json",
  ]);

  return NextResponse.json({
    success: true,
    data: {
      namespace,
      deployment,
      restartedAt,
      revision: parseDeploymentRevision(deploymentJson.stdout),
      restartOutput: restart.stdout.trim() || restart.stderr.trim(),
      statusOutput: status.stdout.trim() || status.stderr.trim(),
    },
  });
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as {
      preview?: unknown;
      confirmation?: { typedPhrase?: string; reason?: string };
    };
  } catch {
    return {};
  }
}

function isPreviewRequest(body: { preview?: unknown }) {
  return body.preview === true;
}

async function runKubectl(args: string[]) {
  return execFileAsync("kubectl", args, {
    timeout: 360_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function parseDeploymentRevision(rawJson: string) {
  try {
    const deployment = JSON.parse(rawJson) as {
      metadata?: { annotations?: Record<string, string> };
    };
    return deployment.metadata?.annotations?.["deployment.kubernetes.io/revision"];
  } catch {
    return undefined;
  }
}
