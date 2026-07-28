import { ConfigService } from "../config/config.service";
import { KafkaService } from "../kafka/kafka.service";

export function createAthenaQueryTelemetryOptions(
  kafka: KafkaService,
  config: ConfigService,
) {
  if (!config.dataPipeline.enabled) {
    return {};
  }

  return {
    publisher: {
      publish: (
        topic: string,
        payload: Record<string, unknown>,
        key?: string,
      ) => kafka.publishPhysicalTopic(topic, payload, key),
    },
  };
}
