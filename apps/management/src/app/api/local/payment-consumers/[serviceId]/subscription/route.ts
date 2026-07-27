import { requireManagementService, managementError } from "../../route-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<Response> {
  try {
    const service = await requireManagementService(request);
    if (service instanceof Response) return service;
    const { serviceId } = await context.params;
    const body = await request.json();
    const result = await service.provisionEventDelivery({
      ...body,
      consumerServiceId: serviceId,
    });
    return Response.json({ success: true, data: result });
  } catch (error) {
    return managementError(error);
  }
}
