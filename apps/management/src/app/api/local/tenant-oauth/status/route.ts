import { NextResponse } from "next/server";

import {
  isTenantOAuthStatus,
  normalizeTenantSlug,
  type TenantOAuthEnvironment,
} from "@/lib/tenant-oauth-lifecycle";
import {
  listTenantOAuthStateRecords,
  upsertTenantOAuthStateRecord,
} from "@/lib/server/tenant-oauth-state-local-store";

export async function GET() {
  const records = await listTenantOAuthStateRecords();
  return NextResponse.json({ success: true, data: { records } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "JSON body is required." } },
      { status: 400 },
    );
  }

  const candidate = body as Record<string, unknown>;
  const tenantName = typeof candidate.tenantName === "string" ? candidate.tenantName : "";
  const tenantSlugInput =
    typeof candidate.tenantSlug === "string" ? candidate.tenantSlug : tenantName;
  const environment: TenantOAuthEnvironment = candidate.environment === "test" ? "test" : "prod";
  const status = typeof candidate.status === "string" ? candidate.status : "";

  if (!tenantSlugInput || !isTenantOAuthStatus(status)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_TENANT_OAUTH_STATUS",
          message: "tenantSlug or tenantName and a valid status are required.",
        },
      },
      { status: 400 },
    );
  }

  const tenantSlug = normalizeTenantSlug(tenantSlugInput);
  const displayName =
    typeof candidate.displayName === "string" && candidate.displayName.trim()
      ? candidate.displayName.trim()
      : tenantName || tenantSlug;
  const authProjectId =
    typeof candidate.authProjectId === "string" ? candidate.authProjectId : "";
  const secretName = typeof candidate.secretName === "string" ? candidate.secretName : "";
  const redirectUri = typeof candidate.redirectUri === "string" ? candidate.redirectUri : "";
  const updatedBy = typeof candidate.updatedBy === "string" ? candidate.updatedBy : undefined;
  const allowSharedOauthFallback = candidate.allowSharedOauthFallback === true;

  if (!authProjectId || !secretName || !redirectUri) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISSING_TENANT_OAUTH_STATUS_FIELDS",
          message: "authProjectId, secretName, and redirectUri are required.",
        },
      },
      { status: 400 },
    );
  }

  const record = await upsertTenantOAuthStateRecord({
    tenantSlug,
    environment,
    status,
    displayName,
    authProjectId,
    secretName,
    redirectUri,
    allowSharedOauthFallback,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });

  return NextResponse.json({ success: true, data: record });
}
