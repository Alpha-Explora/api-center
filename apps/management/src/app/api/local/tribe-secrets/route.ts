import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { tribeSecretProvisionRequestSchema } from "@/lib/schemas";
import { createOperationPreview } from "@/lib/operation-preview";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import {
  createSecretManagerClient,
  getProjectId,
  getSecretManagerAuthReadiness,
  provisionSecretWithLocalGcloudImpersonation,
  shouldUseLocalGcloudImpersonation,
} from "@/lib/server/gcp-secret-manager";

const DEFAULT_SECRET_PREFIX = "api-center-tribe-secret-";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = tribeSecretProvisionRequestSchema.parse(body);
    const actionRisk = input.environment === "live" ? "provider-write" : "state-write";

    if (isPreviewRequest(body)) {
      await requireManagementSession({
        authorizationHeader: request.headers.get("authorization"),
      });

      return NextResponse.json({
        preview: createOperationPreview({
          actionId: "tribe-secret.provision",
          environment: input.environment,
          risk: actionRisk,
          changes: [
            `Create or rotate ${input.environment} Secret Manager hash for owner tribe ${input.tribeId}`,
            `Authorize registered source service ${input.sourceServiceId} to use the tribe secret`,
            "Store only SHA-256 hash payload, not plaintext tribe secret",
            "Preserve prior Secret Manager versions for audit/history",
          ],
        }),
      });
    }

    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    await requireManagementAction({
      session,
      environment: input.environment,
      actionRisk,
      actionId: "tribe-secret.provision",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const projectId = getProjectId();

    if (!projectId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Set GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623 in the management server environment, then restart the app.",
        },
        { status: 500 },
      );
    }

    const authReadiness = getSecretManagerAuthReadiness();
    if (!authReadiness.ok) {
      return NextResponse.json(
        {
          success: false,
          error: authReadiness.message,
        },
        { status: 500 },
      );
    }

    const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
    const secretId = `${prefix}${input.tribeId}-${input.environment}`;
    const secretName = `projects/${projectId}/secrets/${secretId}`;
    const rotatedAt = new Date().toISOString();
    const payload = JSON.stringify({
      tribeId: input.tribeId,
      environment: input.environment,
      provisionedForServiceIds: [input.sourceServiceId],
      sourceServiceId: input.sourceServiceId,
      secretHashSha256: input.secretHashSha256.toLowerCase(),
      status: "active",
      rotationState: "active_current",
      rotatedAt,
      auditEvidence: [
        {
          action: "rotation_started",
          actor: session.email,
          sourceServiceId: input.sourceServiceId,
          environment: input.environment,
          occurredAt: rotatedAt,
        },
      ],
    });

    const versionName = shouldUseLocalGcloudImpersonation()
      ? (
          await provisionSecretWithLocalGcloudImpersonation({
            projectId,
            secretId,
            secretName,
            payload,
          })
        ).versionName
      : await provisionSecretWithGoogleClient({
          projectId,
          secretId,
          secretName,
          payload,
        });
    const versionNumber = /\/versions\/([^/]+)$/.exec(versionName)?.[1];

    return NextResponse.json({
      success: true,
      data: {
        serviceId: input.sourceServiceId,
        tribeId: input.tribeId,
        sourceServiceId: input.sourceServiceId,
        environment: input.environment,
        secretId,
        secretName,
        versionName,
        versionNumber,
        rotatedAt,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.issues[0]?.message ?? "Invalid tribe secret request.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: formatProvisioningError(error),
      },
      { status: 500 },
    );
  }
}

function isPreviewRequest(body: unknown): body is { preview: true } {
  return Boolean(
    body &&
      typeof body === "object" &&
      "preview" in body &&
      (body as { preview?: unknown }).preview === true,
  );
}

function formatProvisioningError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Tribe secret provisioning failed.";

  if (
    message.includes("Could not load the default credentials") ||
    message.includes("default credentials were not found")
  ) {
    return "Google credentials are missing. Set GCP_IMPERSONATE_SERVICE_ACCOUNT or run local ADC login, then retry.";
  }

  if (
    message.includes("Unable to mint a local gcloud impersonated access token") ||
    message.includes("gcloud.cmd") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("iam.serviceAccounts.getAccessToken")
  ) {
    return "Local gcloud impersonation failed. Check that your Google account can impersonate the management provisioner service account.";
  }

  if (message.includes("PERMISSION_DENIED")) {
    return "The local Google account does not have Secret Manager access for this project.";
  }

  if (message.includes("Secret Manager API has not been used")) {
    return "Secret Manager API is not enabled for this project.";
  }

  return "Tribe secret provisioning failed. Check local GCP auth and Secret Manager access.";
}

async function provisionSecretWithGoogleClient(input: {
  projectId: string;
  secretId: string;
  secretName: string;
  payload: string;
}) {
  const client = createSecretManagerClient();
  await ensureSecret(client, input.projectId, input.secretId, input.secretName);
  const [version] = await client.addSecretVersion({
    parent: input.secretName,
    payload: {
      data: Buffer.from(input.payload, "utf8"),
    },
  });

  return version.name || "";
}

async function ensureSecret(
  client: SecretManagerServiceClient,
  projectId: string,
  secretId: string,
  secretName: string,
) {
  try {
    await client.getSecret({ name: secretName });
    return;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 5) {
      throw error;
    }
  }

  await client.createSecret({
    parent: `projects/${projectId}`,
    secretId,
    secret: {
      replication: {
        automatic: {},
      },
    },
  });
}
