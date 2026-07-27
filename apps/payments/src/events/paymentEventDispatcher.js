const { getPaymentStore } = require("../services/paymongo/paymentStore");
const { publishPaymentEvent } = require("./pubsubPublisher");

async function drainPaymentEventOutbox({ limit = 50, logger = console } = {}) {
  const store = getPaymentStore();
  const events = await store.claimPendingPaymentEvents(limit);
  let published = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const result = await publishPaymentEvent(event);
      if (result.disabled) continue;
      if (!result.messageId) throw new Error("Pub/Sub publish did not return a message ID");
      await store.markPaymentEventPublished(event.providerEventId, event.environment);
      published += 1;
    } catch (error) {
      failed += 1;
      await store.markPaymentEventFailed(
        event.providerEventId,
        error instanceof Error ? error.message : String(error),
        event.environment,
      );
      logger.error(`[apicenter-payments] Pub/Sub publish failed for ${event.providerEventId}:`, error);
    }
  }

  return { claimed: events.length, published, failed };
}

function startPaymentEventDispatcher({ intervalMs = 1000, logger = console } = {}) {
  if (process.env.PUBSUB_DISPATCHER_ENABLED !== "true") return null;
  const timer = setInterval(() => {
    drainPaymentEventOutbox({ logger }).catch((error) => logger.error("[apicenter-payments] outbox drain failed:", error));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { drainPaymentEventOutbox, startPaymentEventDispatcher };
