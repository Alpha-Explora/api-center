import { Pool } from 'pg';
import { SmsRecord } from './sms-store';
import { SmsRepositoryInterface } from './sms-repository.interface';

export class PostgresSmsStore implements SmsRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL || process.env.SMS_DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async save(record: SmsRecord): Promise<SmsRecord> {
    const query = `
      INSERT INTO shared_sms.sms_records (message_id, recipient, message, status, sender_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (message_id) DO UPDATE SET
        status = EXCLUDED.status;
    `;
    await this.pool.query(query, [
      record.messageId,
      record.to,
      record.message,
      record.status,
      record.senderId || null,
    ]);
    return record;
  }

  async findById(messageId: string): Promise<SmsRecord | null> {
    const result = await this.pool.query(
      `SELECT message_id, recipient, message, status, sender_id, created_at FROM shared_sms.sms_records WHERE message_id = $1`,
      [messageId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      messageId: row.message_id,
      to: row.recipient,
      message: row.message,
      status: row.status,
      senderId: row.sender_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
