import { Pool } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';
import type { SmsRepositoryInterface } from './sms-repository.interface';

function ownerValues(owner: SharedServiceCaller): string[] {
  return [owner.tribeId, owner.projectId, owner.serviceId, owner.environment];
}

export class PostgresSmsStore implements SmsRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async save(record: SmsRecord, owner: SharedServiceCaller): Promise<SmsRecord> {
    const result = await this.pool.query(
      `INSERT INTO shared_sms.sms_messages AS m
         (message_id, tribe_id, project_id, service_id, environment, recipient, message, status, sender_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (message_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
         WHERE m.tribe_id = EXCLUDED.tribe_id AND m.project_id = EXCLUDED.project_id
           AND m.service_id = EXCLUDED.service_id AND m.environment = EXCLUDED.environment
       RETURNING message_id`,
      [record.messageId, ...ownerValues(owner), record.to, record.message, record.status, record.senderId || null, record.createdAt],
    );
    if (result.rowCount === 0) throw new Error('SMS message id belongs to another owner');
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null> {
    const result = await this.pool.query(
      `SELECT message_id, recipient, message, status, sender_id, created_at
         FROM shared_sms.sms_messages
        WHERE message_id = $1 AND tribe_id = $2 AND project_id = $3 AND service_id = $4 AND environment = $5`,
      [messageId, ...ownerValues(owner)],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      messageId: row.message_id,
      to: row.recipient,
      message: row.message,
      status: row.status,
      senderId: row.sender_id,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
