import { Pool } from 'pg';
import { isDeepStrictEqual } from 'node:util';
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
  /** Reference number PayMongo assigned to the resource. Paid payment-link events are matched only on it. */
  providerReference?: string | null;
  snapshot: Record<string, unknown>;
  amountMinor?: string | null;
  currency?: string | null;
  status?: string | null;
  createdAt?: string;
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
    (resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot,
     amount_minor, currency, status, provider_reference)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint, $10, $11, $12)
   ON CONFLICT (environment, resource_type, resource_id) DO UPDATE SET
     snapshot = EXCLUDED.snapshot,
     amount_minor = COALESCE(EXCLUDED.amount_minor, shared_payment.resource_owners.amount_minor),
     currency = COALESCE(EXCLUDED.currency, shared_payment.resource_owners.currency),
     status = COALESCE(EXCLUDED.status, shared_payment.resource_owners.status),
     provider_reference = COALESCE(shared_payment.resource_owners.provider_reference, EXCLUDED.provider_reference),
     aggregate_version = shared_payment.resource_owners.aggregate_version + 1,
     updated_at = now()
   WHERE shared_payment.resource_owners.tribe_id = EXCLUDED.tribe_id
     AND shared_payment.resource_owners.project_id = EXCLUDED.project_id
   RETURNING aggregate_version`;

const TERMINAL_READ_STATUSES: Record<string, string[]> = {
  intent: ['succeeded', 'cancelled'],
  subscription: ['cancelled', 'incomplete_cancelled'],
  invoice: ['paid', 'void', 'uncollectible'],
};

const FRESH_READ_STATUS = `CASE
  WHEN lower(COALESCE(current_owner.status, '')) = ANY($13::text[]) THEN current_owner.status
  WHEN lower(COALESCE(current_owner.snapshot->>'status', '')) = ANY($13::text[]) THEN current_owner.snapshot->>'status'
  ELSE COALESCE(EXCLUDED.status, current_owner.status) END`;

const FRESH_READ_SNAPSHOT = `(CASE
  WHEN lower(COALESCE(current_owner.status, '')) = ANY($13::text[])
    THEN (current_owner.snapshot || EXCLUDED.snapshot) || jsonb_build_object('status', current_owner.status)
  WHEN lower(COALESCE(current_owner.snapshot->>'status', '')) = ANY($13::text[])
    THEN (current_owner.snapshot || EXCLUDED.snapshot) || jsonb_build_object('status', current_owner.snapshot->>'status')
  ELSE current_owner.snapshot || EXCLUDED.snapshot END)
  - CASE WHEN EXCLUDED.resource_type = 'intent' AND ($14::boolean
      OR lower(COALESCE((${FRESH_READ_STATUS}), '')) = ANY($13::text[]))
    THEN ARRAY['nextAction'] ELSE ARRAY[]::text[] END`;

const UPSERT_FRESH_READ = `INSERT INTO shared_payment.resource_owners AS current_owner
    (resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot,
     amount_minor, currency, status, provider_reference)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint, $10, $11, $12)
   ON CONFLICT (environment, resource_type, resource_id) DO UPDATE SET
     snapshot = ${FRESH_READ_SNAPSHOT},
     amount_minor = COALESCE(EXCLUDED.amount_minor, current_owner.amount_minor),
     currency = COALESCE(EXCLUDED.currency, current_owner.currency),
     status = ${FRESH_READ_STATUS},
     provider_reference = COALESCE(current_owner.provider_reference, EXCLUDED.provider_reference),
     aggregate_version = current_owner.aggregate_version + 1,
     updated_at = now()
   WHERE current_owner.tribe_id = EXCLUDED.tribe_id
     AND current_owner.project_id = EXCLUDED.project_id
     AND ROW(current_owner.snapshot, current_owner.amount_minor, current_owner.currency,
         current_owner.status, current_owner.provider_reference)
       IS DISTINCT FROM ROW(${FRESH_READ_SNAPSHOT}, COALESCE(EXCLUDED.amount_minor, current_owner.amount_minor),
         COALESCE(EXCLUDED.currency, current_owner.currency), (${FRESH_READ_STATUS}),
         COALESCE(current_owner.provider_reference, EXCLUDED.provider_reference))
   RETURNING *`;

function ownerFacts(record: OwnerRecord): { amountMinor: string | null; currency: string | null; status: string | null } {
  const amount = record.amountMinor ?? record.snapshot.amountMinor ?? (typeof record.snapshot.amount === 'number'
    || typeof record.snapshot.amount === 'string' ? record.snapshot.amount : undefined)
    ?? (record.snapshot.amount && typeof record.snapshot.amount === 'object'
      ? (record.snapshot.amount as Record<string, unknown>).amountMinor
        ?? (record.snapshot.amount as Record<string, unknown>).value
        ?? (record.snapshot.amount as Record<string, unknown>).amount
      : undefined);
  const currency = record.currency ?? record.snapshot.currency
    ?? (record.snapshot.amount && typeof record.snapshot.amount === 'object'
      ? (record.snapshot.amount as Record<string, unknown>).currency : undefined);
  const status = record.status ?? record.snapshot.status;
  return {
    amountMinor: amount == null || !/^-?\d+$/.test(String(amount))
      || (typeof amount === 'number' && !Number.isSafeInteger(amount)) ? null : String(amount),
    currency: typeof currency === 'string' ? currency.toUpperCase() : null,
    status: typeof status === 'string' ? status.toLowerCase() : null,
  };
}

function ownerParams(record: OwnerRecord): unknown[] {
  const facts = ownerFacts(record);
  return [record.resourceType, record.resourceId, record.environment, record.tribeId,
    record.projectId, record.consumerServiceId, record.referenceId || null, JSON.stringify(record.snapshot),
    facts.amountMinor, facts.currency, facts.status, record.providerReference || null];
}

export type PaymentRecordFilters = {
  type?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
};

export type PaymentRecordPage = { records: Array<Record<string, unknown>>; nextCursor?: string };

function encodeCursor(createdAt: string, type: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, type, id })).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: string; type: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      || typeof value.type !== 'string' || typeof value.id !== 'string') throw new Error();
    return value;
  } catch {
    throw new PayMongoError('Invalid payment records cursor', 400, 'INVALID_CURSOR');
  }
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

  /** Refresh checkout facts atomically without regressing a payment confirmed by a concurrent webhook. */
  async reconcileCheckout(id: string, context: PaymentContext, fresh: Record<string, unknown> & { status: string }): Promise<OwnerRecord> {
    if (this.pool) {
      const result = await this.pool.query(
        `UPDATE shared_payment.resource_owners
         SET snapshot = snapshot || $5::jsonb, status = $6,
             aggregate_version = aggregate_version + 1, updated_at = now()
         WHERE environment = $1 AND resource_type = 'checkout' AND resource_id = $2
           AND tribe_id = $3 AND project_id = $4
           AND status IS DISTINCT FROM 'paid' AND snapshot->>'status' IS DISTINCT FROM 'paid'
           AND snapshot IS DISTINCT FROM snapshot || $5::jsonb
         RETURNING *`,
        [context.environment, id, context.tribeId, context.projectId, JSON.stringify(fresh), fresh.status],
      );
      if (result.rows[0]) return this.fromRow(result.rows[0]);
      return this.assertOwned('checkout', id, context);
    }
    const record = this.memory.get(this.key(context.environment, 'checkout', id));
    if (!record || record.tribeId !== context.tribeId || record.projectId !== context.projectId) {
      throw new PayMongoError('Payment resource was not found', 404, 'NOT_FOUND');
    }
    const snapshot = { ...record.snapshot, ...fresh };
    if (record.status === 'paid' || record.snapshot.status === 'paid'
      || Object.entries(fresh).every(([key, value]) => record.snapshot[key] === value)) return record;
    this.saveInMemory({ ...record, snapshot, status: String(fresh.status) });
    return this.memory.get(this.key(context.environment, 'checkout', id))!;
  }

  /** Persists a provider read while retaining owner metadata and any already-confirmed terminal status. */
  async reconcileFreshRead(type: 'intent' | 'subscription' | 'invoice', id: string, context: PaymentContext,
    fresh: Record<string, unknown>): Promise<OwnerRecord> {
    const snapshot = Object.fromEntries(Object.entries(fresh).filter(([, value]) => value !== undefined));
    const record: OwnerRecord = { ...context, resourceType: type, resourceId: id, snapshot };
    const terminalStatuses = TERMINAL_READ_STATUSES[type];
    const clearNextAction = type === 'intent' && Object.hasOwn(fresh, 'nextAction') && fresh.nextAction === undefined;
    if (type === 'intent' && terminalStatuses.includes(String(snapshot.status).toLowerCase())) delete snapshot.nextAction;
    if (this.pool) {
      const result = await this.pool.query(UPSERT_FRESH_READ, [...ownerParams(record), terminalStatuses, clearNextAction]);
      if (result.rows[0]) return this.fromRow(result.rows[0]);
      try { return await this.assertOwned(type, id, context); }
      catch (error) {
        if (!(error instanceof PayMongoError) || error.code !== 'NOT_FOUND') throw error;
        throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
      }
    }

    const key = this.key(context.environment, type, id);
    const existing = this.memory.get(key);
    if (existing && (existing.tribeId !== context.tribeId || existing.projectId !== context.projectId)) {
      throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
    }
    if (!existing) {
      this.saveInMemory(record);
      return this.memory.get(key)!;
    }

    const snapshotStatus = String(existing.snapshot.status ?? '').toLowerCase();
    const columnStatus = existing.status?.toLowerCase() ?? '';
    const terminalStatus = TERMINAL_READ_STATUSES[type].includes(columnStatus)
      ? columnStatus : TERMINAL_READ_STATUSES[type].includes(snapshotStatus) ? snapshotStatus : undefined;
    const status = terminalStatus ?? ownerFacts(record).status ?? existing.status ?? null;
    const mergedSnapshot: Record<string, unknown> = { ...existing.snapshot, ...snapshot,
      ...(terminalStatus ? { status: terminalStatus } : {}) };
    if (type === 'intent' && (clearNextAction || terminalStatuses.includes(String(status).toLowerCase()))) {
      delete mergedSnapshot.nextAction;
    }
    const facts = ownerFacts(record);
    const updated = { ...existing, snapshot: mergedSnapshot,
      amountMinor: facts.amountMinor ?? existing.amountMinor ?? null,
      currency: facts.currency ?? existing.currency ?? null,
      status, aggregateVersion: (existing.aggregateVersion ?? 0) + 1 };
    if (isDeepStrictEqual(existing.snapshot, updated.snapshot) && existing.amountMinor === updated.amountMinor
      && existing.currency === updated.currency && existing.status === updated.status) return existing;
    this.memory.set(key, updated);
    return updated;
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
    const facts = ownerFacts(record);
    this.memory.set(key, { ...record, referenceId: record.referenceId || existing?.referenceId,
      providerReference: existing?.providerReference ?? record.providerReference ?? null,
      amountMinor: facts.amountMinor ?? existing?.amountMinor ?? null,
      currency: facts.currency ?? existing?.currency ?? null,
      status: facts.status ?? existing?.status ?? null,
      createdAt: existing?.createdAt ?? record.createdAt ?? new Date().toISOString(), aggregateVersion });
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

  /**
   * Resolves a webhook source by the reference number PayMongo assigned to it. Callers choose reference_id,
   * so it is never used here. Only the signature-verified webhook path may call this.
   */
  async findWebhookSourceByProviderReference(type: string, providerReference: string, environment: 'test' | 'live'):
    Promise<OwnerRecord | undefined> {
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id,
                provider_reference, snapshot, aggregate_version
         FROM shared_payment.resource_owners
         WHERE environment = $1 AND resource_type = $2 AND provider_reference = $3`,
        [environment, type, providerReference],
      );
      return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
    }
    return [...this.memory.values()].find((record) => record.environment === environment
      && record.resourceType === type && record.providerReference === providerReference);
  }

  async findByReference(type: string, referenceId: string, context: PaymentContext): Promise<OwnerRecord> {
    let record: OwnerRecord | undefined;
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id,
                provider_reference, snapshot, amount_minor, currency, status, aggregate_version
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

  async listRecords(context: PaymentContext, filters: PaymentRecordFilters = {}): Promise<PaymentRecordPage> {
    const limit = filters.limit ?? 50;
    const cursor = decodeCursor(filters.cursor);
    const conditions = ['project_id = $1', 'environment = $2', 'tribe_id = $3'];
    const values: unknown[] = [context.projectId, context.environment, context.tribeId];
    const add = (condition: string, value: unknown) => { values.push(value); conditions.push(condition.replace('?', `$${values.length}`)); };
    if (filters.type) add('resource_type = ?', filters.type);
    if (filters.status) add('status = ?', filters.status.toLowerCase());
    if (filters.createdAfter) add('created_at >= ?::timestamptz', filters.createdAfter);
    if (filters.createdBefore) add('created_at < ?::timestamptz', filters.createdBefore);
    if (cursor) {
      values.push(cursor.createdAt, cursor.type, cursor.id);
      const n = values.length - 2;
      conditions.push(`(created_at, resource_type, resource_id) < ($${n}::timestamptz, $${n + 1}, $${n + 2})`);
    }
    values.push(limit + 1);
    const sql = `SELECT resource_type, resource_id, project_id, environment, reference_id, amount_minor,
        currency, status, created_at, snapshot,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM shared_payment.resource_owners WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, resource_type DESC, resource_id DESC LIMIT $${values.length}`;
    let rows: any[];
    if (this.pool) {
      rows = (await this.pool.query(sql, values)).rows;
    } else {
      const lower = filters.createdAfter ? Date.parse(filters.createdAfter) : Number.NEGATIVE_INFINITY;
      const upper = filters.createdBefore ? Date.parse(filters.createdBefore) : Number.POSITIVE_INFINITY;
      rows = [...this.memory.values()].filter((row) => row.projectId === context.projectId && row.tribeId === context.tribeId
        && row.environment === context.environment && (!filters.type || row.resourceType === filters.type)
        && (!filters.status || row.status?.toLowerCase() === filters.status.toLowerCase())
        && (!cursor || `${row.createdAt || ''}|${row.resourceType}|${row.resourceId}` < `${cursor.createdAt}|${cursor.type}|${cursor.id}`)
        && Date.parse(row.createdAt || '') >= lower && Date.parse(row.createdAt || '') < upper)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.resourceType.localeCompare(a.resourceType)
          || b.resourceId.localeCompare(a.resourceId)).slice(0, limit + 1);
    }
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const records = pageRows.map((row) => ({
      type: row.resource_type ?? row.resourceType,
      id: row.resource_id ?? row.resourceId,
      projectId: row.project_id ?? row.projectId,
      environment: row.environment,
      referenceId: row.reference_id ?? row.referenceId ?? null,
      amountMinor: row.amount_minor == null ? (row.amountMinor ?? null) : String(row.amount_minor),
      currency: row.currency ?? null,
      status: row.status ?? null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? row.createdAt,
      relatedResourceId: row.snapshot?.paymentId ?? row.snapshot?.sourceId ?? null,
    }));
    const last = pageRows[pageRows.length - 1];
    const createdAt = last?.created_at instanceof Date ? last.created_at.toISOString() : last?.created_at ?? last?.createdAt;
    const cursorCreatedAt = last?.cursor_created_at ?? createdAt;
    return { records, ...(hasMore && last && cursorCreatedAt
      ? { nextCursor: encodeCursor(cursorCreatedAt, last.resource_type ?? last.resourceType, last.resource_id ?? last.resourceId) }
      : {}) };
  }

  /** Lists snapshots owned by one project, used for provider resources that are created outside APICenter. */
  async listOwned(context: PaymentContext, resourceType: string): Promise<Array<Record<string, unknown>>> {
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT snapshot FROM shared_payment.resource_owners
         WHERE environment = $1 AND tribe_id = $2 AND project_id = $3 AND resource_type = $4
         ORDER BY created_at DESC, resource_id DESC`,
        [context.environment, context.tribeId, context.projectId, resourceType],
      );
      return result.rows.map((row) => row.snapshot);
    }
    return [...this.memory.values()]
      .filter((record) => record.environment === context.environment && record.tribeId === context.tribeId
        && record.projectId === context.projectId && record.resourceType === resourceType)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.resourceId.localeCompare(a.resourceId))
      .map((record) => record.snapshot);
  }

  private async find(type: string, id: string, environment: string): Promise<OwnerRecord | undefined> {
    if (!this.pool) return this.memory.get(this.key(environment, type, id));
    const result = await this.pool.query(
      `SELECT resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id,
              provider_reference, snapshot, amount_minor, currency, status, aggregate_version
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
      providerReference: row.provider_reference ?? null,
      snapshot: row.snapshot, amountMinor: row.amount_minor == null ? null : String(row.amount_minor),
      currency: row.currency, status: row.status, aggregateVersion: Number(row.aggregate_version ?? 1) };
  }

  private key(environment: string, type: string, id: string): string {
    return `${environment}:${type}:${id}`;
  }
}
