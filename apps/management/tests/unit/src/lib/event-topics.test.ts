import { afterEach, describe, expect, it } from "vitest";
import {
  getServiceEventTopics,
  getTribeEventTopic,
  normalizeTopicIdentifier,
} from "../../../../src/lib/event-topics";

describe("getServiceEventTopics", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX;
  });

  it("uses unprefixed live topic names when no topic prefix is configured", () => {
    const topics = getServiceEventTopics({
      serviceId: "flow-ci",
      serviceType: "tribe",
    });

    expect(topics.primary).toBe("tribe.flow-ci.events");
    expect(topics.sharedExport).toBe("api-center.shared.flow-ci.events");
  });

  it("uses ownerTribeId for tribe-owned service event topics", () => {
    const topics = getServiceEventTopics({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      serviceType: "tribe",
    });

    expect(topics.primary).toBe("tribe.logistics.events");
    expect(topics.tribeEvents).toBe("tribe.logistics.events");
    expect(topics.topicOwnerId).toBe("logistics");
  });

  it("builds tribe topics from explicit environment keys", () => {
    expect(
      getServiceEventTopics({
        serviceId: "trinithrive",
        ownerTribeId: "trinithrive",
        serviceType: "tribe",
        environment: "staging",
      }).tribeEvents,
    ).toBe("staging.tribe.trinithrive.events");
  });

  it("normalizes canonical tribe topic identifiers", () => {
    expect(normalizeTopicIdentifier("Flow CI")).toBe("flow-ci");
    expect(normalizeTopicIdentifier("FLOW_CI")).toBe("flow_ci");
    expect(normalizeTopicIdentifier("flow.ci")).toBe("flow.ci");
    expect(normalizeTopicIdentifier("flow-ci")).toBe("flow-ci");
    expect(getTribeEventTopic("Flow CI")).toBe("tribe.flow-ci.events");
  });

  it("rejects identifiers that cannot become stable topic owners", () => {
    expect(() => normalizeTopicIdentifier(" ")).toThrow(
      "Topic identifier cannot be empty.",
    );
    expect(() => normalizeTopicIdentifier(".flow-ci")).toThrow(
      "Topic identifier cannot start or end with '.' or '-'.",
    );
    expect(() => normalizeTopicIdentifier("flow..ci")).toThrow(
      "Topic identifier cannot contain consecutive dots.",
    );
  });

  it("uses prefixed test topic names when the test prefix is configured", () => {
    process.env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX = "test";

    const topics = getServiceEventTopics({
      serviceId: "flow-ci",
      serviceType: "shared",
    });

    expect(topics.primary).toBe("test.api-center.shared.flow-ci.events");
    expect(topics.tribeEvents).toBe("test.tribe.flow-ci.events");
    expect(topics.topicOwnerId).toBe("flow-ci");
  });
});
