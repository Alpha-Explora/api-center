import { getWorkflowProgress, type WorkflowStep } from "@/lib/workflow-steps";

type PaymentSubscriptionRolloutFlowProps = {
  mode: "test" | "live";
  checkoutReady: boolean;
  subscriptionReady: boolean;
  webhookReady: boolean;
};

export function PaymentSubscriptionRolloutFlow(props: PaymentSubscriptionRolloutFlowProps) {
  const steps: WorkflowStep[] = [
    {
      id: "checkout",
      label: "Checkout wrapper",
      status: props.checkoutReady ? "complete" : "active",
      detail: "Stripe-like checkout create, retrieve, expire, and event mapping.",
    },
    {
      id: "subscription",
      label: "Subscription wrapper",
      status: props.subscriptionReady ? "complete" : props.checkoutReady ? "active" : "pending",
      detail: "Stripe-like subscription create, update, cancel, list, and retrieve operations.",
    },
    {
      id: "webhook",
      label: "Webhook persistence",
      status: props.webhookReady ? "complete" : props.subscriptionReady ? "active" : "pending",
      detail: "PayMongo webhook events stored in shared payments schema.",
    },
    {
      id: "live",
      label: "Live rollout guard",
      status: props.mode === "live" && props.webhookReady ? "active" : "pending",
      detail: "Live writes require typed confirmation, reason, and audit capture.",
    },
  ];

  const progress = getWorkflowProgress(steps);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Payment rollout</h2>
        <p className="text-sm text-muted-foreground">
          {progress.complete} of {progress.total} steps complete
        </p>
      </div>
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
