import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import {
  accessLatestSecretPayload,
  createSecretManagerClient,
  getProjectId,
  getSecretManagerAuthReadiness,
  provisionSecretWithLocalGcloudImpersonation,
  shouldUseLocalGcloudImpersonation,
} from "@/lib/server/gcp-secret-manager";

const DEFAULT_SECRET_PREFIX = "api-center-tribe-secret-";
const LEGACY_TEST_SECRET_PREFIX = "api-center-test-tribe-secret-";
const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

const legacyMigrationRequestSchema = z.object({
  tribeId: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Use lower-case letters, numbers, and hyphens only",
    ),
  sourceServiceId: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Use lower-case letters, numbers, and hyphens only",
    ),
  environment: z.literal("test"),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

type LegacySecretPayload = {
  serviceId?: unknown;
  tribeId?: unknown;
  secretHashSha256?: unknown;
  status?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = legacyMigrationRequestSchema.parse(body);
    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    await requireManagementAction({
      session,
      environment: input.environment,
      actionRisk: "state-write",
      actionId: "tribe-secret.migrate-legacy-test",
      typedPhrase: input.confirmation?.typedPhrase,
      reason: input.confirmation?.reason,
    });

    const projectId = getProjectId();
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "GOOGLE_CLOUD_PROJECT is required." },
        { status: 500 },
      );
    }

    const authReadiness = getSecretManagerAuthReadiness();
    if (!authReadiness.ok) {
      return NextResponse.json(
        { success: false, error: authReadiness.message },
        { status: 500 },
      );
    }

    const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
    const legacy = await readFirstLegacyPayload({
      projectId,
      legacySecretIds: [
        `${prefix}${input.tribeId}`,
        `${LEGACY_TEST_SECRET_PREFIX}${input.tribeId}`,
      ],
    });
    if (!legacy) {
      return NextResponse.json(
        { success: false, error: "Legacy tribe secret was not found." },
        { status: 404 },
      );
    }

    const secretHashSha256 = extractSecretHash({
      rawPayload: legacy.payload,
      secretName: legacy.secretId,
      tribeId: input.tribeId,
      sourceServiceId: input.sourceServiceId,
    });
    const targetSecretId = `${prefix}${input.tribeId}-${input.environment}`;
    const targetSecretName = `projects/${projectId}/secrets/${targetSecretId}`;
    const migratedAt = new Date().toISOString();
    const payload = JSON.stringify({
      tribeId: input.tribeId,
      environment: input.environment,
      provisionedForServiceIds: [input.sourceServiceId],
      sourceServiceId: input.sourceServiceId,
      secretHashSha256,
      status: "active",
      rotationState: "active_current",
      rotatedAt: migratedAt,
      auditEvidence: [
        {
          action: "legacy_hash_copied",
          actor: session.email,
          sourceServiceId: input.sourceServiceId,
          environment: input.environment,
          occurredAt: migratedAt,
          legacySecretId: legacy.secretId,
        },
      ],
    });

    const versionName = shouldUseLocalGcloudImpersonation()
      ? (
          await provisionSecretWithLocalGcloudImpersonation({
            projectId,
            secretId: targetSecretId,
            secretName: targetSecretName,
            payload,
          })
        ).versionName
      : await provisionSecretWithGoogleClient({
          projectId,
          secretId: targetSecretId,
          secretName: targetSecretName,
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
        legacySecretId: legacy.secretId,
        secretId: targetSecretId,
        secretName: targetSecretName,
        versionName,
        versionNumber,
        migratedAt,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.issues[0]?.message ?? "Invalid legacy migration request.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Legacy tribe secret migration failed.",
      },
      { status: 500 },
    );
  }
}

async function readFirstLegacyPayload(input: {
  projectId: string;
  legacySecretIds: string[];
}) {
  for (const secretId of input.legacySecretIds) {
    const payload = await accessLatestSecretPayload(
      `projects/${input.projectId}/secrets/${secretId}`,
    );
    if (payload) return { secretId, payload };
  }

  return null;
}

function extractSecretHash(input: {
  rawPayload: string;
  secretName: string;
  tribeId: string;
  sourceServiceId: string;
}) {
  const normalizedPayload = input.rawPayload.trim();
  if (SHA_256_HEX_PATTERN.test(normalizedPayload)) {
    return normalizedPayload.toLowerCase();
  }

  let parsed: LegacySecretPayload;
  try {
    parsed = JSON.parse(normalizedPayload) as LegacySecretPayload;
  } catch {
    throw new Error(
      `Legacy tribe secret '${input.secretName}' payload is not JSON or a raw SHA-256 hash.`,
    );
  }

  const payloadServiceId =
    typeof parsed.serviceId === "string" ? normalizeServiceId(parsed.serviceId) : null;
  const payloadTribeId =
    typeof parsed.tribeId === "string" ? normalizeServiceId(parsed.tribeId) : null;

  if (payloadServiceId && payloadServiceId !== input.sourceServiceId) {
    throw new Error(
      `Legacy tribe secret '${input.secretName}' serviceId does not match '${input.sourceServiceId}'.`,
    );
  }

  if (payloadTribeId && payloadTribeId !== input.tribeId) {
    throw new Error(
      `Legacy tribe secret '${input.secretName}' tribeId does not match '${input.tribeId}'.`,
    );
  }

  if (parsed.status && parsed.status !== "active") {
    throw new Error(`Legacy tribe secret '${input.secretName}' is inactive.`);
  }

  const secretHashSha256 =
    typeof parsed.secretHashSha256 === "string"
      ? parsed.secretHashSha256.trim().toLowerCase()
      : "";
  if (!SHA_256_HEX_PATTERN.test(secretHashSha256)) {
    throw new Error(
      `Legacy tribe secret '${input.secretName}' secretHashSha256 is malformed.`,
    );
  }

  return secretHashSha256;
}

function normalizeServiceId(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)
    ? normalized
    : null;
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