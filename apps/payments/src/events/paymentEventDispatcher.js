const { Pool } = require('pg');
const { closePaymentEventPublishers, publishPaymentEvent } = require('./pubsubPublisher');

const CLAIM_LEASE_SECONDS = 6 * 60;
const DEFAULT_BATCH_SIZE = 50;

function createPaymentEventPool(connectionString = process.env.SHARED_SERVICES_DATABASE_URL
  || process.env.PAYMENT_DATABASE_URL || process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('A payment database URL is required to drain the payment outbox');
  return new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
}

async function claimPendingPaymentEvents(pool, limit) {
  await pool.query(
    `UPDATE shared_payment.payment_event_outbox
     SET status = 'quarantined', quarantine_reason = COALESCE(quarantine_reason, 'Claim lease expired at maximum attempts'),
         quarantined_at = COALESCE(quarantined_at, now()), quarantine_expires_at = COALESCE(quarantine_expires_at, now() + interval '30 days'),
         quarantine_attempts = quarantine_attempts + 1, claim_token = NULL, claimed_at = NULL, updated_at = now()
     WHERE attempts >= max_attempts AND status = 'processing' AND claimed_at < now() - make_interval(secs => $1)`,
    [CLAIM_LEASE_SECONDS],
  );

  const result = await pool.query(
    `WITH ready AS (
       SELECT id
       FROM shared_payment.payment_event_outbox
       WHERE attempts < max_attempts
         AND ((status = 'pending' AND available_at <= now())
           OR (status = 'processing' AND claimed_at < now() - make_interval(secs => $2)))
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE shared_payment.payment_event_outbox AS event
     SET status = 'processing', claim_token = gen_random_uuid(), claimed_at = now(),
         attempts = event.attempts + 1, updated_at = now()
     FROM ready
     WHERE event.id = ready.id
     RETURNING event.id, event.environment, event.provider, event.provider_event_id AS "providerEventId",
       event.event_type AS "eventType", event.aggregate_type AS "aggregateType", event.aggregate_id AS "aggregateId",
       event.aggregate_version AS "aggregateVersion", event.payload, event.owner_tribe_id AS "ownerTribeId",
       event.consumer_service_id AS "consumerServiceId", event.reference_id AS "referenceId",
       event.project_id AS "ownerProjectId",
       event.attempts, event.max_attempts AS "maxAttempts", event.claim_token AS "claimToken"`,
    [limit, CLAIM_LEASE_SECONDS],
  );
  return result.rows;
}

async function readPaymentEventOutboxStats(pool) {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'processing') AS processing,
       COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
       COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending'))), 0)
         AS oldest_pending_seconds
     FROM shared_payment.payment_event_outbox`,
  );
  const row = result.rows[0] || {};
  return {
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    quarantined: Number(row.quarantined || 0),
    oldestPendingSeconds: Math.max(0, Math.floor(Number(row.oldest_pending_seconds || 0))),
  };
}

async function markPaymentEventPublished(pool, event) {
  const result = await pool.query(
    `UPDATE shared_payment.payment_event_outbox
     SET status = 'published', published_at = now(), claim_token = NULL, claimed_at = NULL,
         last_error = NULL, updated_at = now()
     WHERE id = $1 AND claim_token = $2 AND status = 'processing'`,
    [event.id, event.claimToken],
  );
  if (result.rowCount !== 1) throw new Error('Payment event claim was lost before publish acknowledgement');
}

async function markPaymentEventFailed(pool, event, error) {
  const message = String(error instanceof Error ? error.message : error).slice(0, 2000);
  const delaySeconds = Math.min(300, 2 ** Math.min(Number(event.attempts) || 1, 8));
  const result = await pool.query(
    `UPDATE shared_payment.payment_event_outbox
     SET status = CASE WHEN attempts >= max_attempts THEN 'quarantined' ELSE 'pending' END,
         available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + ($3 * interval '1 second') END,
         last_error = $4,
         quarantine_reason = CASE WHEN attempts >= max_attempts THEN $4 ELSE quarantine_reason END,
         quarantine_attempts = CASE WHEN attempts >= max_attempts THEN quarantine_attempts + 1 ELSE quarantine_attempts END,
         quarantined_at = CASE WHEN attempts >= max_attempts THEN now() ELSE quarantined_at END,
         quarantine_expires_at = CASE WHEN attempts >= max_attempts THEN now() + interval '30 days' ELSE quarantine_expires_at END,
         claim_token = NULL, claimed_at = NULL, updated_at = now()
     WHERE id = $1 AND claim_token = $2 AND status = 'processing'`,
    [event.id, event.claimToken, delaySeconds, message],
  );
  if (result.rowCount !== 1) throw new Error('Payment event claim was lost before failure acknowledgement');
}

async function drainPaymentEventOutbox({ limit = DEFAULT_BATCH_SIZE, logger = console, pool: providedPool, publish = publishPaymentEvent } = {}) {
  if (process.env.PUBSUB_DISPATCHER_ENABLED !== 'true') {
    throw new Error('PUBSUB_DISPATCHER_ENABLED=true is required for the payment event worker');
  }
  const batchSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || DEFAULT_BATCH_SIZE)));
  const pool = providedPool || createPaymentEventPool();
  const ownsPool = !providedPool;
  let published = 0;
  let failed = 0;
  let events = [];
  try {
    events = await claimPendingPaymentEvents(pool, batchSize);
    for (const event of events) {
      try {
        const result = await publish(event);
        if (result?.disabled || !result?.messageId) throw new Error('Pub/Sub publish did not return a message ID');
        await markPaymentEventPublished(pool, event);
        published += 1;
      } catch (error) {
        failed += 1;
        try {
          await markPaymentEventFailed(pool, event, error);
        } catch (ackError) {
          logger.error('[apicenter-payments] Unable to record payment event failure:', ackError);
        }
        logger.error(`[apicenter-payments] Pub/Sub publish failed for ${event.providerEventId}:`, error);
      }
    }
    if (typeof logger.log === 'function') {
      try {
        const queue = await readPaymentEventOutboxStats(pool);
        logger.log(JSON.stringify({
          type: 'apicenter_payment_outbox_metric',
          claimed: events.length,
          published,
          failed,
          ...queue,
        }));
      } catch (error) {
        logger.error('[apicenter-payments] Unable to collect payment outbox metrics:', error);
      }
    }
    return { claimed: events.length, published, failed };
  } finally {
    if (ownsPool) await pool.end();
    if (ownsPool) await closePaymentEventPublishers();
  }
}

async function main() {
  const limit = Number(process.env.APICENTER_PAYMENT_OUTBOX_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  const summary = await drainPaymentEventOutbox({ limit });
  console.log(JSON.stringify({ service: 'apicenter-payment-event-dispatcher', ...summary }));
  if (summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('[apicenter-payments] payment event worker failed:', error);
    await closePaymentEventPublishers().catch(() => undefined);
    process.exitCode = 1;
  });
}

module.exports = {
  claimPendingPaymentEvents,
  drainPaymentEventOutbox,
  markPaymentEventFailed,
  markPaymentEventPublished,
  readPaymentEventOutboxStats,
};
