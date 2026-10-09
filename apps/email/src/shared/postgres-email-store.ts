import { Pool } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';
import type { EmailRepositoryInterface } from './email-repository.interface';

export class PostgresEmailStore implements EmailRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  /** Records the creating caller. A later save may update only a message in the same project and environment. */
  async save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord> {
    const result = await this.pool.query(
      `INSERT INTO shared_email.email_messages AS m
         (message_id, tribe_id, project_id, service_id, environment, provider, status, recipients, recipient_count, sent_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (message_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
         WHERE m.project_id = EXCLUDED.project_id AND m.environment = EXCLUDED.environment
       RETURNING message_id`,
      [
        record.messageId, owner.tribeId, owner.projectId, owner.serviceId, owner.environment,
        record.provider, record.status, record.recipient, record.recipientCount, record.sentAt, record.createdAt,
      ],
    );
    if (result.rowCount === 0) throw new Error('Email message id belongs to another project');
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null> {
    const result = await this.pool.query(
      `SELECT message_id, provider, status, recipients, recipient_count, sent_at, created_at
         FROM shared_email.email_messages
        WHERE message_id = $1 AND project_id = $2 AND environment = $3`,
      [messageId, owner.projectId, owner.environment],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      messageId: row.message_id,
      provider: row.provider,
      status: row.status,
      recipient: row.recipients,
      recipientCount: Number(row.recipient_count),
      sentAt: new Date(row.sent_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
