import { NextResponse } from "next/server";

import { buildTenantOAuthPreview } from "@/lib/tenant-oauth-lifecycle";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "JSON body is required.",
        },
      },
      { status: 400 },
    );
  }

  const candidate = body as Record<string, unknown>;
  const tenantName = typeof candidate.tenantName === "string" ? candidate.tenantName : "";
  const environment = candidate.environment === "test" ? "test" : "prod";
  const runtimeFolderId =
    typeof candidate.runtimeFolderId === "string"
      ? candidate.runtimeFolderId
      : process.env.APIC_CUSTOMER_RUNTIME_DEDICATED_FOLDER_ID || "";
  const billingAccountName =
    typeof candidate.billingAccountName === "string"
      ? candidate.billingAccountName
      : process.env.APIC_BILLING_ACCOUNT_NAME || "";
  const callbackUrl =
    typeof candidate.callbackUrl === "string"
      ? candidate.callbackUrl
      : "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback";

  if (!tenantName || !runtimeFolderId || !billingAccountName) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISSING_TENANT_OAUTH_INPUT",
          message: "tenantName, runtimeFolderId, and billingAccountName are required.",
        },
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      success: true,
      data: buildTenantOAuthPreview({
        product: "apicenter",
        tenantName,
        environment,
        runtimeFolderId,
        billingAccountName,
        callbackUrl,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "TENANT_OAUTH_PREVIEW_FAILED",
          message: error instanceof Error ? error.message : "Unable to build tenant OAuth preview.",
        },
      },
      { status: 400 },
    );
  }
}
