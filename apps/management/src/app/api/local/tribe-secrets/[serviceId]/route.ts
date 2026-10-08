import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { tribeSecretDeleteRequestSchema } from "@/lib/schemas";
import { createOperationPreview } from "@/lib/operation-preview";
import { getTribeSecretRotationWarning } from "@/lib/secret-status";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import {
  deleteTribeSecret,
  accessLatestSecretPayload,
  getProjectId,
  getSecretManagerAuthReadiness,
  getTribeSecretStatus,
} from "@/lib/server/gcp-secret-manager";

const DEFAULT_SECRET_PREFIX = "api-center-service-secret-";
const SERVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type RuntimeEnvironment = "test" | "live";

type Context = {
  params: Promise<{ serviceId: string }>;
};

type SecretSetup =
  | {
      projectId: string;
      serviceId: string;
      environment: RuntimeEnvironment;
      secretId: string;
      secretName: string;
    }
  | {
      response: NextResponse;
    };

export async function GET(request: Request, context: Context) {
  const { serviceId } = await context.params;

  try {
    await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });

    const environment = readEnvironmentFromUrl(request.url);
    const setup = getSecretSetup(serviceId, environment);
    if ("response" in setup) return setup.response;

    const data = await getTribeSecretStatus(setup);
    const inheritedFromTribeSecret = data.exists
      ? await readMigrationMarker(setup.secretName)
      : false;
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        environment: setup.environment,
        rotationWarning: getTribeSecretRotationWarning({
          exists: data.exists,
          enabled: data.enabled,
          latestVersionCreatedAt: data.latestVersionCreatedAt,
          inheritedFromTribeSecret,
        }),
      },
    });
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Could not read service secret status.",
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const { serviceId } = await context.params;

  try {
    const body = await request.json();
    const input = tribeSecretDeleteRequestSchema.parse(body);

    if (isPreviewRequest(body)) {
      await requireManagementSession({
        authorizationHeader: request.headers.get("authorization"),
      });

      return NextResponse.json({
        preview: createOperationPreview({
          actionId: "tribe-secret.delete",
          environment: input.environment,
          risk: "destructive",
          changes: [
            `Delete ${input.environment} Secret Manager secret for service ${serviceId}`,
            "Stop this service from requesting new API Center tokens in the target environment",
            "This does not delete registry entry, Kafka topic, or historical S3 data",
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
      actionRisk: "destructive",
      actionId: "tribe-secret.delete",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    if (input.confirmServiceId !== serviceId) {
      return NextResponse.json(
        { success: false, error: "Confirmation did not match service ID." },
        { status: 400 },
      );
    }

    const setup = getSecretSetup(serviceId, input.environment);
    if ("response" in setup) return setup.response;

    const data = await deleteTribeSecret(setup);
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        environment: setup.environment,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.issues[0]?.message ?? "Invalid request.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: formatSecretDeleteError(error),
      },
      { status: 500 },
    );
  }
}

/** True while the secret payload is still the copy made when credentials moved from tribe to service. */
async function readMigrationMarker(secretName: string): Promise<boolean> {
  try {
    const raw = await accessLatestSecretPayload(secretName);
    if (!raw) return false;
    const payload = JSON.parse(raw) as { migratedFromTribeSecret?: unknown };
    return payload.migratedFromTribeSecret === true;
  } catch {
    return false;
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

function readEnvironmentFromUrl(url: string): RuntimeEnvironment {
  const value = new URL(url).searchParams.get("environment") ?? "test";
  if (value === "test" || value === "live") return value;
  throw new Error("environment must be one of: test, live");
}

function getSecretSetup(
  serviceId: string,
  environment: RuntimeEnvironment,
): SecretSetup {
  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: "Invalid service ID.",
        },
        { status: 400 },
      ),
    };
  }

  const projectId = getProjectId();
  if (!projectId) {
    return {
      response: NextResponse.json(
        { success: false, error: "GOOGLE_CLOUD_PROJECT is required." },
        { status: 500 },
      ),
    };
  }

  const authReadiness = getSecretManagerAuthReadiness();
  if (!authReadiness.ok) {
    return {
      response: NextResponse.json(
        { success: false, error: authReadiness.message },
        { status: 500 },
      ),
    };
  }

  const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
  const secretId = `${prefix}${serviceId}-${environment}`;

  return {
    projectId,
    serviceId,
    environment,
    secretId,
    secretName: `projects/${projectId}/secrets/${secretId}`,
  };
}

function formatSecretDeleteError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Tribe secret cleanup failed.";

  if (
    message.includes("secretmanager.secrets.delete") ||
    message.includes("PERMISSION_DENIED")
  ) {
    return "The management provisioner cannot delete service secrets yet.";
  }

  return "Tribe secret cleanup failed. Check Secret Manager access.";
}
