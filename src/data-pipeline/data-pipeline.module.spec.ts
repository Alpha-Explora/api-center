import { ConfigService } from "../config/config.service";
import { KafkaService } from "../kafka/kafka.service";
import { createAthenaQueryTelemetryOptions } from "./athena-query-telemetry-options";

describe("DataPipelineModule", () => {
  it("does not configure an Athena telemetry publisher when the data pipeline is disabled", () => {
    const kafka = {
      publishPhysicalTopic: jest.fn(),
    } as unknown as KafkaService;
    const config = {
      dataPipeline: { enabled: false },
    } as ConfigService;

    const options = createAthenaQueryTelemetryOptions(kafka, config);

    expect(options).toEqual({});
  });

  it("uses Kafka physical topic publishing when the data pipeline is enabled", async () => {
    const kafka = {
      publishPhysicalTopic: jest.fn(async () => undefined),
    } as unknown as KafkaService;
    const config = {
      dataPipeline: { enabled: true },
    } as ConfigService;

    const options = createAthenaQueryTelemetryOptions(kafka, config);
    await options.publisher?.publish("test.topic", { event: "ok" }, "key-1");

    expect(kafka.publishPhysicalTopic).toHaveBeenCalledWith(
      "test.topic",
      { event: "ok" },
      "key-1",
    );
  });
});
