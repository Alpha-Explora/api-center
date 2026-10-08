import { NextResponse } from "next/server";

import { listQuotaPolicies, listServices } from "@/lib/api-center-client";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tribeId: string }> },
) {
  try {
    const { tribeId } = await params;
    await requireManagementRouteAction({
      request,
      actionRisk: "read",
      actionId: "developer-portal.packet.read",
    });

    const decodedTribeId = decodeURIComponent(tribeId);
    const [services, quotaPolicies] = await Promise.all([
      listServices(),
      listQuotaPolicies(decodedTribeId),
    ]);

    const ownedServices = services.filter((service) => {
      if ((service.serviceType ?? "tribe") !== "tribe") return false;
      return service.ownerTribeId === decodedTribeId;
    });
    const allowedIds = new Set(
      ownedServices.flatMap((service) => service.consumes ?? []),
    );
    const scopedServicesById = new Map(
      ownedServices.map((service) => [service.serviceId, service]),
    );

    for (const service of services) {
      if (allowedIds.has(service.serviceId)) {
        scopedServicesById.set(service.serviceId, service);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        tribeId: decodedTribeId,
        services: [...scopedServicesById.values()],
        quotaPolicies,
      },
    });
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Developer portal packet request failed.",
    );
  }
}
