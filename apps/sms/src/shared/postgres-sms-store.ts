import { Pool } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';
import type { SmsRepositoryInterface } from './sms-repository.interface';
import type { SmsDeliveryEvent } from './sms-repository.interface';
import type { ProjectSmsSender } from './project-sender';

export class PostgresSmsStore implements SmsRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  /** Records the creating caller. A later save may update only a record in the same project and environment. */
  async save(record: SmsRecord, owner: SharedServiceCaller): Promise<SmsRecord> {
    const result = await this.pool.query(
      `INSERT INTO shared_sms.sms_messages AS m
         (message_id, tribe_id, project_id, service_id, environment, recipient, message, status, sender_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (message_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
         WHERE m.project_id = EXCLUDED.project_id AND m.environment = EXCLUDED.environment
       RETURNING message_id`,
      [
        record.messageId, owner.tribeId, owner.projectId, owner.serviceId, owner.environment,
        record.to, record.message, record.status, record.senderId || null, record.createdAt,
      ],
    );
    if (result.rowCount === 0) throw new Error('SMS message id belongs to another project');
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null> {
    const result = await this.pool.query(
      `SELECT message_id, recipient, message, status, sender_id, created_at
         FROM shared_sms.sms_messages
        WHERE message_id = $1 AND project_id = $2 AND environment = $3`,
      [messageId, owner.projectId, owner.environment],
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

  async applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        `INSERT INTO shared_sms.sms_delivery_events (provider_event_id, message_id, status, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider_event_id) DO NOTHING
         RETURNING provider_event_id`,
        [event.providerEventId, event.messageId, event.status, event.payload],
      );
      if (inserted.rowCount === 0) {
        await client.query('commit');
        return { duplicate: true };
      }
      const updated = await client.query(
        `UPDATE shared_sms.sms_messages SET status = $2, updated_at = now() WHERE message_id = $1 RETURNING message_id`,
        [event.messageId, event.status],
      );
      if (updated.rowCount === 0) throw new Error('SMS message is not yet recorded');
      await client.query('commit');
      return { duplicate: false };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getProjectSender(projectId: string, environment: ProjectSmsSender['environment']): Promise<ProjectSmsSender | null> {
    const result = await this.pool.query(
      `SELECT project_id, environment, sender_id
         FROM shared_sms.project_senders
        WHERE project_id = $1 AND environment = $2`,
      [projectId, environment],
    );
    return result.rows.length === 0 ? null : mapProjectSender(result.rows[0]);
  }

  async setProjectSender(sender: ProjectSmsSender): Promise<ProjectSmsSender> {
    const result = await this.pool.query(
      `INSERT INTO shared_sms.project_senders (project_id, environment, sender_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, environment) DO UPDATE
         SET sender_id = EXCLUDED.sender_id, updated_at = now()
       RETURNING project_id, environment, sender_id`,
      [sender.projectId, sender.environment, sender.senderId],
    );
    return mapProjectSender(result.rows[0]);
  }
}

function mapProjectSender(row: Record<string, unknown>): ProjectSmsSender {
  return {
    projectId: String(row.project_id),
    environment: row.environment as ProjectSmsSender['environment'],
    senderId: row.sender_id === null ? null : String(row.sender_id),
  };
}
