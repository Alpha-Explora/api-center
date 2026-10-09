import { Pool } from 'pg';
import { PayMongoError } from './payment-errors';

/** Trusted tenant identity used to scope payment resources. */
export type PaymentContext = {
  tribeId: string;
  projectId: string;
  consumerServiceId: string;
  environment: 'test' | 'live';
};

export type OwnerRecord = PaymentContext & {
  resourceType: string;
  resourceId: string;
  referenceId?: string;
  snapshot: Record<string, unknown>;
  /** Counts state changes of this resource. Set by the store; callers never write it. */
  aggregateVersion?: number;
};

/** An event queued for the dispatcher in the same transaction as the state change it describes. */
export type WebhookOutboxEvent = {
  eventType: string;
  /** Type and ID of the owner record whose version is stamped on the event. */
  aggregateType: string;
  aggregateId: string;
  ownerTribeId: string;
  ownerProjectId: string;
  consumerServiceId: string;
  referenceId: string;
  payload: Record<string, unknown>;
};

export type VerifiedWebhook = {
  providerEventId: string;
  environment: PaymentContext['environment'];
  eventType: string;
  /** Hash of the raw body, used to catch a provider event ID that is reused with different content. */
  payloadHash: string;
  /** Owner records to update. */
  updates: OwnerRecord[];
  outbox?: WebhookOutboxEvent;
  receiptStatus: 'processed' | 'needs_reconciliation';
  receiptNote?: string;
};

export type AppliedWebhook = { duplicate: boolean; queued: boolean };

const UPSERT_OWNER = `INSERT INTO shared_payment.resource_owners
    (resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
   ON CONFLICT (environment, resource_type, resource_id) DO UPDATE SET
     snapshot = EXCLUDED.snapshot,
     aggregate_version = shared_payment.resource_owners.aggregate_version + 1,
     updated_at = now()
   WHERE shared_payment.resource_owners.tribe_id = EXCLUDED.tribe_id
     AND shared_payment.resource_owners.project_id = EXCLUDED.project_id
   RETURNING aggregate_version`;

function ownerParams(record: OwnerRecord): unknown[] {
  return [record.resourceType, record.resourceId, record.environment, record.tribeId,
    record.projectId, record.consumerServiceId, record.referenceId || null, JSON.stringify(record.snapshot)];
}

/** Persists payment resource ownership and rejects cross-tenant lookups. */
export class PaymentOwnerStore {
  private static instance: PaymentOwnerStore;
  private readonly memory = new Map<string, OwnerRecord>();
  private readonly memoryReceipts = new Map<string, string>();
  private readonly memoryOutbox: Array<WebhookOutboxEvent & { providerEventId: string; aggregateVersion: number }> = [];
  private readonly pool?: Pool;

  constructor(connectionString = process.env.SHARED_SERVICES_DATABASE_URL || process.env.PAYMENT_DATABASE_URL || process.env.DATABASE_URL) {
    if (connectionString) this.pool = new Pool({ connectionString, max: 5 });
    else if (process.env.NODE_ENV === 'production') throw new Error('Payment database URL is required in production');
  }

  static getInstance(): PaymentOwnerStore {
    if (!this.instance) this.instance = new PaymentOwnerStore();
    return this.instance;
  }

  async save(record: OwnerRecord): Promise<void> {
    if (this.pool) {
      const result = await this.pool.query(UPSERT_OWNER, ownerParams(record));
      if (!result.rowCount) throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
      return;
    }
    this.saveInMemory(record);
  }

  /**
   * Commits a signature-verified webhook as one unit: the receipt, the owner state changes and the outbox
   * event. A provider event ID that was already received changes nothing, so a redelivery cannot update
   * state twice or queue a second event.
   */
  async applyVerifiedWebhook(webhook: VerifiedWebhook): Promise<AppliedWebhook> {
    if (!this.pool) return this.applyWebhookInMemory(webhook);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // provider_mode holds the environment, so the unique index scopes deduplication by environment.
      const receipt = await client.query(
        `INSERT INTO shared_payment.payment_webhook_events
           (provider, provider_mode, provider_event_id, event_type, status, payload_hash, error_message, processed_at)
         VALUES ('paymongo', $1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (provider, provider_mode, provider_event_id) DO NOTHING
         RETURNING id`,
        [webhook.environment, webhook.providerEventId, webhook.eventType, webhook.receiptStatus,
          webhook.payloadHash, webhook.receiptNote || null],
      );
      if (!receipt.rowCount) {
        const previous = await client.query(
          `SELECT payload_hash FROM shared_payment.payment_webhook_events
           WHERE provider = 'paymongo' AND provider_mode = $1 AND provider_event_id = $2`,
          [webhook.environment, webhook.providerEventId],
        );
        this.assertSameWebhookContent(previous.rows[0]?.payload_hash, webhook.payloadHash);
        await client.query('ROLLBACK');
        return { duplicate: true, queued: false };
      }

      let aggregateVersion: number | undefined;
      for (const record of webhook.updates) {
        const saved = await client.query(UPSERT_OWNER, ownerParams(record));
        if (!saved.rowCount) throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
        if (this.isAggregate(webhook.outbox, record)) aggregateVersion = Number(saved.rows[0].aggregate_version);
      }

      const outbox = webhook.outbox;
      if (outbox) {
        if (aggregateVersion === undefined) throw new Error('The webhook did not update the aggregate its event describes');
        const queued = await client.query(
          `INSERT INTO shared_payment.payment_event_outbox
             (environment, provider, provider_event_id, event_type, aggregate_type, aggregate_id,
              aggregate_version, payload, owner_tribe_id, project_id, consumer_service_id, reference_id)
           VALUES ($1, 'paymongo', $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
           ON CONFLICT (environment, provider, provider_event_id) DO NOTHING
           RETURNING id`,
          [webhook.environment, webhook.providerEventId, outbox.eventType, outbox.aggregateType, outbox.aggregateId,
            aggregateVersion, JSON.stringify(outbox.payload), outbox.ownerTribeId, outbox.ownerProjectId,
            outbox.consumerServiceId, outbox.referenceId],
        );
        // An outbox row without a receipt means the receipt was purged. The event was already queued.
        if (!queued.rowCount) {
          await client.query('ROLLBACK');
          return { duplicate: true, queued: false };
        }
      }
      await client.query('COMMIT');
      return { duplicate: false, queued: Boolean(outbox) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Events queued by webhooks when no database is configured. For tests and local development. */
  queuedEvents(): ReadonlyArray<WebhookOutboxEvent & { providerEventId: string; aggregateVersion: number }> {
    return [...this.memoryOutbox];
  }

  private applyWebhookInMemory(webhook: VerifiedWebhook): AppliedWebhook {
    const receiptKey = this.key(webhook.environment, 'webhook', webhook.providerEventId);
    const previousHash = this.memoryReceipts.get(receiptKey);
    if (previousHash !== undefined) {
      this.assertSameWebhookContent(previousHash, webhook.payloadHash);
      return { duplicate: true, queued: false };
    }
    if (webhook.updates.some((record) => this.foreignOwner(record))) {
      throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
    }
    let aggregateVersion = 0;
    for (const record of webhook.updates) {
      const version = this.saveInMemory(record);
      if (this.isAggregate(webhook.outbox, record)) aggregateVersion = version;
    }
    this.memoryReceipts.set(receiptKey, webhook.payloadHash);
    if (webhook.outbox) {
      this.memoryOutbox.push({ ...webhook.outbox, providerEventId: webhook.providerEventId, aggregateVersion });
    }
    return { duplicate: false, queued: Boolean(webhook.outbox) };
  }

  private saveInMemory(record: OwnerRecord): number {
    if (this.foreignOwner(record)) {
      throw new PayMongoError('Payment resource belongs to another consumer', 403, 'FORBIDDEN');
    }
    const key = this.key(record.environment, record.resourceType, record.resourceId);
    const existing = this.memory.get(key);
    const aggregateVersion = (existing?.aggregateVersion ?? 0) + 1;
    this.memory.set(key, { ...record, referenceId: record.referenceId || existing?.referenceId, aggregateVersion });
    return aggregateVersion;
  }

  private foreignOwner(record: OwnerRecord): boolean {
    const existing = this.memory.get(this.key(record.environment, record.resourceType, record.resourceId));
    return Boolean(existing && (existing.tribeId !== record.tribeId || existing.projectId !== record.projectId));
  }

  private isAggregate(outbox: WebhookOutboxEvent | undefined, record: OwnerRecord): boolean {
    return Boolean(outbox && record.resourceType === outbox.aggregateType && record.resourceId === outbox.aggregateId);
  }

  private assertSameWebhookContent(previousHash: string | null | undefined, payloadHash: string): void {
    if (previousHash && previousHash !== payloadHash) {
      throw new PayMongoError('Provider event ID was reused with different webhook content', 409, 'WEBHOOK_REPLAY_MISMATCH');
    }
  }

  async assertOwned(type: string, id: string, context: PaymentContext): Promise<OwnerRecord> {
    const record = await this.find(type, id, context.environment);
    if (!record || record.tribeId !== context.tribeId || record.projectId !== context.projectId) {
      throw new PayMongoError('Payment resource was not found', 404, 'NOT_FOUND');
    }
    return record;
  }

  // Only the signature-verified webhook path may resolve a source without a caller context.
  async findWebhookSource(type: string, id: string, environment: 'test' | 'live'): Promise<OwnerRecord | undefined> {
    return this.find(type, id, environment);
  }

  async findByReference(type: string, referenceId: string, context: PaymentContext): Promise<OwnerRecord> {
    let record: OwnerRecord | undefined;
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot, aggregate_version
         FROM shared_payment.resource_owners
         WHERE environment = $1 AND resource_type = $2 AND tribe_id = $3 AND project_id = $4
           AND reference_id = $5
         LIMIT 1`,
        [context.environment, type, context.tribeId, context.projectId, referenceId],
      );
      if (result.rows[0]) record = this.fromRow(result.rows[0]);
    } else {
      record = [...this.memory.values()].find((entry) => entry.resourceType === type
        && entry.referenceId === referenceId && entry.environment === context.environment
        && entry.tribeId === context.tribeId && entry.projectId === context.projectId);
    }
    if (!record) throw new PayMongoError('Payment resource was not found', 404, 'NOT_FOUND');
    return record;
  }

  private async find(type: string, id: string, environment: string): Promise<OwnerRecord | undefined> {
    if (!this.pool) return this.memory.get(this.key(environment, type, id));
    const result = await this.pool.query(
      `SELECT resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot, aggregate_version
       FROM shared_payment.resource_owners
       WHERE environment = $1 AND resource_type = $2 AND resource_id = $3`,
      [environment, type, id],
    );
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  private fromRow(row: any): OwnerRecord {
    return { resourceType: row.resource_type, resourceId: row.resource_id,
      environment: row.environment, tribeId: row.tribe_id,
      projectId: row.project_id,
      consumerServiceId: row.consumer_service_id, referenceId: row.reference_id,
      snapshot: row.snapshot, aggregateVersion: Number(row.aggregate_version ?? 1) };
  }

  private key(environment: string, type: string, id: string): string {
    return `${environment}:${type}:${id}`;
  }
}
