const { createPaymentEventPool } = require("./paymentEventDispatcher");
const { replayPaymentEvent } = require("./paymentEventReplay");
const { publicEventId } = require("./pubsubPublisher");
const { randomUUID } = require("node:crypto");

function recoveryError(code, status) {
  return Object.assign(new Error(code), { code, status });
}
class PaymentReplayStore {
  constructor({ pool, publish } = {}) {
    this.providedPool = pool;
    this.publish = publish;
    this.ownedPool = null;
  }
  pool() {
    return this.providedPool || (this.ownedPool ||= createPaymentEventPool());
  }
  async list(context, limit = 50) {
    const result = await this.pool().query(
      `SELECT e.id,e.provider_event_id,e.event_type AS "eventType",e.aggregate_type AS "aggregateType",
        e.aggregate_id AS "aggregateId",e.aggregate_version AS "aggregateVersion",e.status,e.published_at AS "publishedAt",e.attempts,
        r.attempt_id AS "replayAttemptId",r.status AS "replayStatus",r.created_at AS "replayCreatedAt"
       FROM shared_payment.payment_event_outbox e LEFT JOIN LATERAL
        (SELECT attempt_id,status,created_at FROM shared_payment.payment_replay_attempts WHERE event_id=e.id ORDER BY created_at DESC LIMIT 1) r ON true
       WHERE e.owner_tribe_id=$1 AND e.project_id=$2 AND e.consumer_service_id=$3 AND e.environment=$4
       ORDER BY e.created_at DESC,e.id DESC LIMIT $5`,
      [
        context.tribeId,
        context.projectId,
        context.consumerServiceId,
        context.environment,
        Math.min(100, Math.max(1, limit)),
      ],
    );
    return result.rows.map(({ provider_event_id, ...row }) => ({
      ...row,
      eventId: publicEventId(provider_event_id),
      consumerAcknowledgedAt: null,
      lastDeliveryAt: null,
      deadLetterCount: null,
    }));
  }
  async replay({ eventId, operationId, reason, actor, context }) {
    const pool = this.pool();
    const client = await pool.connect();
    let event;
    let attempt;
    try {
      await client.query("BEGIN");
      const events = await client.query(
        `SELECT id,environment,provider_event_id AS "providerEventId",event_type AS "eventType",aggregate_type AS "aggregateType",aggregate_id AS "aggregateId",
          aggregate_version AS "aggregateVersion",payload,owner_tribe_id AS "ownerTribeId",consumer_service_id AS "consumerServiceId",project_id AS "ownerProjectId",created_at AS "createdAt"
         FROM shared_payment.payment_event_outbox WHERE id=$1 AND owner_tribe_id=$2 AND project_id=$3 AND consumer_service_id=$4 AND environment=$5 FOR UPDATE`,
        [
          eventId,
          context.tribeId,
          context.projectId,
          context.consumerServiceId,
          context.environment,
        ],
      );
      event = events.rows[0];
      if (!event) throw recoveryError("PAYMENT_EVENT_NOT_FOUND", 404);
      const previous = await client.query(
        'SELECT attempt_id AS "attemptId",status,reason,actor FROM shared_payment.payment_replay_attempts WHERE event_id=$1 AND operation_id=$2',
        [eventId, operationId],
      );
      if (previous.rows[0]) {
        if (
          previous.rows[0].reason !== reason ||
          previous.rows[0].actor !== actor
        )
          throw recoveryError("REPLAY_OPERATION_MISMATCH", 409);
        await client.query("COMMIT");
        return {
          attemptId: previous.rows[0].attemptId,
          status: previous.rows[0].status,
        };
      }
      const active = await client.query(
        "SELECT attempt_id FROM shared_payment.payment_replay_attempts WHERE event_id=$1 AND status IN ('running','uncertain')",
        [eventId],
      );
      if (active.rows.length)
        throw recoveryError("REPLAY_REQUIRES_RECONCILIATION", 409);
      attempt = randomUUID();
      await client.query(
        "INSERT INTO shared_payment.payment_replay_attempts(attempt_id,event_id,operation_id,status,actor,reason) VALUES ($1,$2,$3,'running',$4,$5)",
        [attempt, eventId, operationId, actor, reason],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    try {
      const result = await replayPaymentEvent(
        event,
        this.publish ? { publish: this.publish } : {},
      );
      const status = result.published ? "published" : "failed";
      await pool.query(
        "UPDATE shared_payment.payment_replay_attempts SET status=$2,published_at=CASE WHEN $2='published' THEN now() ELSE NULL END,updated_at=now() WHERE attempt_id=$1",
        [attempt, status],
      );
      return { attemptId: attempt, status };
    } catch {
      await pool.query(
        "UPDATE shared_payment.payment_replay_attempts SET status='uncertain',updated_at=now() WHERE attempt_id=$1",
        [attempt],
      );
      return { attemptId: attempt, status: "uncertain" };
    }
  }
  async close() {
    if (this.ownedPool) await this.ownedPool.end();
  }
}
module.exports = { PaymentReplayStore };
