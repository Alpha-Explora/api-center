import { Pool } from 'pg';
import { PayMongoError } from './payment-errors';

/** Trusted tenant identity used to scope payment resources. */
export type PaymentContext = {
  tribeId: string;
  consumerServiceId: string;
  environment: 'test' | 'live';
};

type OwnerRecord = PaymentContext & {
  resourceType: string;
  resourceId: string;
  referenceId?: string;
  snapshot: Record<string, unknown>;
};

/** Persists payment resource ownership and rejects cross-tenant lookups. */
export class PaymentOwnerStore {
  private static instance: PaymentOwnerStore;
  private readonly memory = new Map<string, OwnerRecord>();
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
      const result = await this.pool.query(
        `INSERT INTO shared_payment.resource_owners
          (resource_type, resource_id, environment, tribe_id, consumer_service_id, reference_id, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (environment, resource_type, resource_id) DO UPDATE SET
           snapshot = EXCLUDED.snapshot, updated_at = now()
         WHERE shared_payment.resource_owners.tribe_id = EXCLUDED.tribe_id
           RETURNING resource_id`,
        [record.resourceType, record.resourceId, record.environment, record.tribeId,
          record.consumerServiceId, record.referenceId || null, JSON.stringify(record.snapshot)],
      );
      if (!result.rowCount) throw new PayMongoError('Payment resource belongs to another tribe', 403, 'FORBIDDEN');
      return;
    }
    const key = this.key(record.environment, record.resourceType, record.resourceId);
    const existing = this.memory.get(key);
    if (existing && existing.tribeId !== record.tribeId) {
      throw new PayMongoError('Payment resource belongs to another consumer', 403, 'FORBIDDEN');
    }
    this.memory.set(key, { ...record, referenceId: record.referenceId || existing?.referenceId });
  }

  async assertOwned(type: string, id: string, context: PaymentContext): Promise<OwnerRecord> {
    const record = await this.find(type, id, context.environment);
    if (!record || record.tribeId !== context.tribeId) {
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
        `SELECT resource_type, resource_id, environment, tribe_id, consumer_service_id, reference_id, snapshot
         FROM shared_payment.resource_owners
         WHERE environment = $1 AND resource_type = $2 AND tribe_id = $3
           AND reference_id = $4
         LIMIT 1`,
        [context.environment, type, context.tribeId, referenceId],
      );
      if (result.rows[0]) record = this.fromRow(result.rows[0]);
    } else {
      record = [...this.memory.values()].find((entry) => entry.resourceType === type
        && entry.referenceId === referenceId && entry.environment === context.environment
        && entry.tribeId === context.tribeId);
    }
    if (!record) throw new PayMongoError('Payment resource was not found', 404, 'NOT_FOUND');
    return record;
  }

  private async find(type: string, id: string, environment: string): Promise<OwnerRecord | undefined> {
    if (!this.pool) return this.memory.get(this.key(environment, type, id));
    const result = await this.pool.query(
      `SELECT resource_type, resource_id, environment, tribe_id, consumer_service_id, reference_id, snapshot
       FROM shared_payment.resource_owners
       WHERE environment = $1 AND resource_type = $2 AND resource_id = $3`,
      [environment, type, id],
    );
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  private fromRow(row: any): OwnerRecord {
    return { resourceType: row.resource_type, resourceId: row.resource_id,
      environment: row.environment, tribeId: row.tribe_id,
      consumerServiceId: row.consumer_service_id, referenceId: row.reference_id,
      snapshot: row.snapshot };
  }

  private key(environment: string, type: string, id: string): string {
    return `${environment}:${type}:${id}`;
  }
}
