// APICenter webhook delivery. Pub/Sub pushes each event for a destination to
// POST /deliveries/:destinationId (Cloud Run admits only the push service account), and this service
// signs it and POSTs it to the consumer's URL. A non-2xx answer here makes Pub/Sub retry.
import { createSharedServiceApp } from "@apicenter/runtime";
import type { Request, Response } from "express";
import { createSecretManagerDestinationStore, type DestinationStore } from "./destination-store";
import { deliver, type PushEnvelope } from "./delivery";
import { createHttpsSender, type Sender } from "./send";

export function createWebhookApp(deps: { store: DestinationStore; send: Sender }) {
  const { app } = createSharedServiceApp({ serviceId: "webhooks", health: { status: "ok", service: "webhooks" } });

  app.post("/deliveries/:destinationId", async (req: Request, res: Response) => {
    const destinationId = String(req.params.destinationId);
    const started = Date.now();
    try {
      const outcome = await deliver(destinationId, (req.body ?? {}) as PushEnvelope, deps);
      console.log(
        JSON.stringify({
          type: "apicenter_webhook_delivery",
          destinationId,
          attempt: (req.body as PushEnvelope | undefined)?.deliveryAttempt ?? 1,
          latencyMs: Date.now() - started,
          ...outcome,
        }),
      );
      return res.status(outcome.ack ? 204 : outcome.reason === "unknown_destination" ? 404 : 503).end();
    } catch (error) {
      console.error(JSON.stringify({ type: "apicenter_webhook_delivery_error", destinationId, message: (error as Error).message }));
      return res.status(503).end();
    }
  });

  return app;
}

if (require.main === module) {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID is required");
  const port = Number(process.env.PORT || 4020);
  createWebhookApp({ store: createSecretManagerDestinationStore({ projectId }), send: createHttpsSender() }).listen(port, () => {
    console.log(`[apicenter-webhooks] listening on port ${port}`);
  });
}
