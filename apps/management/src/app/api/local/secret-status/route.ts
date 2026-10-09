import { NextResponse } from "next/server";
import { summarizeSharedServiceProviderConfigs } from "@/lib/secret-status";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;

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
