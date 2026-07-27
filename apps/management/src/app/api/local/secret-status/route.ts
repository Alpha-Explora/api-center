import { NextResponse } from "next/server";
import { summarizeSharedServiceProviderConfigs } from "@/lib/secret-status";
import { requireManagementSession } from "@/lib/server/require-management-session";

export async function GET(request: Request) {
  await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });

  const observedKeyNames = parseObservedKeyNames(
    process.env.SHARED_SERVICES_SECRET_KEY_NAMES,
  );

  return NextResponse.json({
    sharedServices: summarizeSharedServiceProviderConfigs({
      secretName:
        process.env.SHARED_SERVICES_SECRET_NAME ?? "api-shared-services-prod",
      exists: observedKeyNames.length > 0,
      observedKeyNames,
    }),
  });
}

function parseObservedKeyNames(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}
