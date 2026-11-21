// APICenter webhook delivery. Pub/Sub pushes each event for a destination to
// POST /deliveries/:destinationId (Cloud Run admits only the push service account and the gateway), and
// this service signs it and POSTs it to the consumer's URL. A non-2xx answer here makes Pub/Sub retry.
// Every attempt is recorded in the delivery history, which the gateway reads through the admin route.
// Pub/Sub is answered first and the history written afterwards, without waiting: a slow or hung
// database must never delay the acknowledgement, or Pub/Sub would redeliver an event the consumer
// already received. Writing after the response needs CPU after the response: the service runs with
// run.googleapis.com/cpu-throttling "false" (infra/gcp/cloud-run/workspace/apicenter-webhooks-live.json).
// With throttling on, a cold instance timed out connecting and the delivery never reached the history.
import { createHash, timingSafeEqual } from "node:crypto";
import { createSharedServiceApp } from "@apicenter/runtime";
import type { Request, Response } from "express";
import { createSecretManagerDestinationStore, DESTINATION_ID, type DestinationStore } from "./destination-store";
import { deliver, type PushEnvelope } from "./delivery";
import { attemptFor, createDeliveryLog, MAX_LISTED_ATTEMPTS, type DeliveryLog } from "./delivery-log";
import { createHttpsSender, type Sender } from "./send";

export const ADMIN_TOKEN_HEADER = "X-APICenter-Webhooks-Admin-Token";

export function createWebhookApp(deps: { store: DestinationStore; send: Sender; log: DeliveryLog; adminToken?: string; now?: () => number }) {
  const { app } = createSharedServiceApp({ serviceId: "webhooks", health: { status: "ok", service: "webhooks" } });
  const now = deps.now ?? Date.now;

  app.post("/deliveries/:destinationId", async (req: Request, res: Response) => {
    const destinationId = String(req.params.destinationId);
    const started = now();
    const attempt = (req.body as PushEnvelope | undefined)?.deliveryAttempt ?? 1;
    try {
      const outcome = await deliver(destinationId, (req.body ?? {}) as PushEnvelope, { ...deps, now });
      const latencyMs = now() - started;
      console.log(JSON.stringify({ type: "apicenter_webhook_delivery", destinationId, attempt, latencyMs, ...outcome }));
      res.status(outcome.ack ? 204 : outcome.reason === "unknown_destination" ? 404 : 503).end();
      const record = attemptFor(destinationId, outcome, { attempt, latencyMs, at: new Date(started) });
      if (record) {
        void Promise.resolve()
          .then(() => deps.log.record(record))
          .catch((error: Error) => {
            console.error(JSON.stringify({ type: "apicenter_webhook_history_error", destinationId, message: error.message }));
          });
      }
      return;
    } catch (error) {
      console.error(JSON.stringify({ type: "apicenter_webhook_delivery_error", destinationId, message: (error as Error).message }));
      return res.status(503).end();
    }
  });

  /** Recent attempts for one destination, newest first. The gateway checks the caller owns it. */
  app.get("/admin/destinations/:destinationId/deliveries", async (req: Request, res: Response) => {
    if (!tokenMatches(req.header(ADMIN_TOKEN_HEADER), deps.adminToken)) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Webhooks admin token is invalid." });
    }
    const destinationId = String(req.params.destinationId);
    if (!DESTINATION_ID.test(destinationId)) return res.status(400).json({ error: "INVALID_DESTINATION", message: "Destination ID is invalid." });
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, MAX_LISTED_ATTEMPTS) : 50;
    try {
      return res.status(200).json({ deliveries: await deps.log.list(destinationId, limit) });
    } catch (error) {
      console.error(JSON.stringify({ type: "apicenter_webhook_history_error", destinationId, message: (error as Error).message }));
      return res.status(503).json({ error: "HISTORY_UNAVAILABLE", message: "Delivery history could not be read." });
    }
  });

  return app;
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(candidate).digest(), createHash("sha256").update(expected).digest());
}

if (require.main === module) {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID is required");
  const port = Number(process.env.PORT || 4020);
  createWebhookApp({
    store: createSecretManagerDestinationStore({ projectId }),
    send: createHttpsSender(),
    log: createDeliveryLog(),
    adminToken: process.env.WEBHOOKS_ADMIN_TOKEN?.trim() || undefined,
  }).listen(port, () => {
    console.log(`[apicenter-webhooks] listening on port ${port}`);
  });
}
