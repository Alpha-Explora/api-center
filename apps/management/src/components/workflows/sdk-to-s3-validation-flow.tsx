import { type WorkflowStep } from "@/lib/workflow-steps";

type SdkToS3ValidationFlowProps = {
  sdkConfigured: boolean;
  gatewayEventsSeen: boolean;
  kafkaEventsSeen: boolean;
  s3ObjectsSeen: boolean;
};

export function SdkToS3ValidationFlow(props: SdkToS3ValidationFlowProps) {
  const steps: WorkflowStep[] = [
    {
      id: "sdk",
      label: "SDK configured",
      status: props.sdkConfigured ? "complete" : "active",
      detail: "Tribe app has package auth, runtime API Center URL, and tribe credentials.",
    },
    {
      id: "gateway",
      label: "Gateway events observed",
      status: props.gatewayEventsSeen ? "complete" : props.sdkConfigured ? "active" : "pending",
      detail: "API Center receives governed request or shared-service telemetry.",
    },
    {
      id: "kafka",
      label: "Kafka events observed",
      status: props.kafkaEventsSeen ? "complete" : props.gatewayEventsSeen ? "active" : "pending",
      detail: "Confluent topic contains the expected event stream.",
    },
    {
      id: "s3",
      label: "S3 objects observed",
      status: props.s3ObjectsSeen ? "complete" : props.kafkaEventsSeen ? "active" : "pending",
      detail: "Connector writes partitioned objects to the expected AWS S3 destination.",
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">SDK to S3 validation</h2>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div key={step.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{step.label}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {step.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
