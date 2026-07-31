import { Injectable } from "@nestjs/common";

type ServiceNode = {
  serviceId: string;
  serviceType?: "tribe" | "shared" | string;
  consumes?: string[];
  exposes?: string[];
};

type TopicNode = {
  ownerTribeId: string;
  topicName: string;
};

export interface DependencyEdge {
  from: string;
  to: string;
  type: string;
}

@Injectable()
export class RuntimeDependencyMapService {
  build(input: { services: ServiceNode[]; topics: TopicNode[] }) {
    const nodes = [
      ...input.services.map((service) => ({
        id: service.serviceId,
        type: service.serviceType ?? "tribe",
        label: service.serviceId,
      })),
      ...input.topics.map((topic) => ({
        id: topic.topicName,
        type: "kafka-topic",
        label: topic.topicName,
      })),
    ];

    const edges = [
      ...input.services.flatMap((service) =>
        (service.consumes ?? []).map((target) => ({
          from: service.serviceId,
          to: target,
          type: target === "kafka" ? "kafka" : "shared-service",
        })),
      ),
      ...input.topics.map((topic) => ({
        from: topic.ownerTribeId,
        to: topic.topicName,
        type: "kafka-topic",
      })),
    ];

    return { nodes, edges };
  }
}
