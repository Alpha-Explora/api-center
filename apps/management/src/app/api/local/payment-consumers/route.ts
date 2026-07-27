import { requireManagementService, managementError } from "./route-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    const service = await requireManagementService(request);
    if (service instanceof Response) return service;
    const result = await service.registerPaymentConsumer(await request.json());
    return Response.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return managementError(error);
  }
}
