import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { KafkaService } from "../kafka/kafka.service";
import {
  ATHENA_QUERY_TELEMETRY_OPTIONS,
  AthenaQueryTelemetryService,
} from "./athena-query-telemetry.service";
import { EventSchemaRegistryController } from "./event-schema-registry.controller";
import { EventSchemaRegistryService } from "./event-schema-registry.service";
import { DecisionSignalsController } from "./decision-signals.controller";
import {
  DECISION_SIGNALS_SERVICE_OPTIONS,
  DecisionSignalsService,
} from "./decision-signals.service";
import { PipelineFeedbackController } from "./pipeline-feedback.controller";
import {
  PIPELINE_FEEDBACK_SERVICE_OPTIONS,
  PipelineFeedbackService,
} from "./pipeline-feedback.service";
import { PipelineHealthController } from "./pipeline-health.controller";
import {
  PIPELINE_GOVERNANCE_SERVICE_OPTIONS,
  PipelineGovernanceService,
} from "./pipeline-governance.service";
import {
  PIPELINE_HEALTH_SERVICE_OPTIONS,
  PipelineHealthService,
} from "./pipeline-health.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    PipelineHealthController,
    EventSchemaRegistryController,
    PipelineFeedbackController,
    DecisionSignalsController,
  ],
  providers: [
    {
      provide: ATHENA_QUERY_TELEMETRY_OPTIONS,
      inject: [KafkaService],
      useFactory: (kafka: KafkaService) => ({
        publisher: {
          publish: (
            topic: string,
            payload: Record<string, unknown>,
            key?: string,
          ) => kafka.publishPhysicalTopic(topic, payload, key),
        },
      }),
    },
    AthenaQueryTelemetryService,
    {
      provide: PIPELINE_HEALTH_SERVICE_OPTIONS,
      inject: [AthenaQueryTelemetryService],
      useFactory: (athenaTelemetry: AthenaQueryTelemetryService) => ({
        athenaTelemetry,
      }),
    },
    {
      provide: PIPELINE_GOVERNANCE_SERVICE_OPTIONS,
      inject: [AthenaQueryTelemetryService],
      useFactory: (athenaTelemetry: AthenaQueryTelemetryService) => ({
        athenaTelemetry,
      }),
    },
    {
      provide: PIPELINE_FEEDBACK_SERVICE_OPTIONS,
      useValue: {},
    },
    {
      provide: DECISION_SIGNALS_SERVICE_OPTIONS,
      inject: [AthenaQueryTelemetryService],
      useFactory: (athenaTelemetry: AthenaQueryTelemetryService) => ({
        athenaTelemetry,
      }),
    },
    PipelineHealthService,
    PipelineGovernanceService,
    PipelineFeedbackService,
    DecisionSignalsService,
    EventSchemaRegistryService,
  ],
  exports: [
    PipelineHealthService,
    PipelineGovernanceService,
    PipelineFeedbackService,
    DecisionSignalsService,
    EventSchemaRegistryService,
  ],
})
export class DataPipelineModule {}
