import { EventSchemaRegistryController } from "./event-schema-registry.controller";
import { EventSchemaRegistryService } from "./event-schema-registry.service";
import { AuthenticatedRequest } from "../types";

describe("EventSchemaRegistryController", () => {
  const registry = {
    listRecords: jest.fn(),
    getRegistryVersion: jest.fn(),
  } as unknown as EventSchemaRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    (registry.listRecords as jest.Mock).mockResolvedValue([
      {
        tribeId: "orders",
        eventType: "order.created",
        schemaVersion: "1.0.0",
        environment: "test",
      },
    ]);
    (registry.getRegistryVersion as jest.Mock).mockResolvedValue(
      "fixture-registry-v1",
    );
  });

  it("lists event schema registry records for the requested environment and tribe", async () => {
    const controller = new EventSchemaRegistryController(registry);

    const response = await controller.listSchemas("test", "orders", {
      correlationId: "corr-schema-1",
    } as AuthenticatedRequest);

    expect(registry.listRecords).toHaveBeenCalledWith({
      environment: "test",
      tribeId: "orders",
    });
    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        data: [
          expect.objectContaining({
            eventType: "order.created",
            schemaVersion: "1.0.0",
          }),
        ],
        meta: expect.objectContaining({
          environment: "test",
          tribeId: "orders",
          schemaRegistryVersion: "fixture-registry-v1",
          correlationId: "corr-schema-1",
        }),
      }),
    );
  });
});
