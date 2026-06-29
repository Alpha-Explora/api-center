import { RuntimeDependencyMapService } from "../../../../src/operations/runtime-dependency-map.service";

describe("RuntimeDependencyMapService", () => {
  it("builds tribe to shared service and Kafka dependencies", () => {
    const service = new RuntimeDependencyMapService();

    const map = service.build({
      services: [
        {
          serviceId: "campus-one",
          serviceType: "tribe",
          consumes: ["payment-service", "kafka"],
          exposes: ["/students"],
        },
        {
          serviceId: "payment-service",
          serviceType: "shared",
          consumes: [],
          exposes: ["/payments"],
        },
      ],
      topics: [
        { ownerTribeId: "campus-one", topicName: "tribe.campus-one.events" },
      ],
    });

    expect(map.edges).toContainEqual({
      from: "campus-one",
      to: "payment-service",
      type: "shared-service",
    });
    expect(map.edges).toContainEqual({
      from: "campus-one",
      to: "tribe.campus-one.events",
      type: "kafka-topic",
    });
  });
});
