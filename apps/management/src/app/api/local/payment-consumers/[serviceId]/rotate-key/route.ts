import { requireManagementService, managementError } from "../../route-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<Response> {
  try {
    const service = requireManagementService(request);
    if (service instanceof Response) return service;
    const { serviceId } = await context.params;
    const result = await service.rotatePaymentApiKey(serviceId, await request.json());
    return Response.json({ success: true, data: result });
  } catch (error) {
    return managementError(error);
  }
}
