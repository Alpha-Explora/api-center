import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';
import type { EmailDeliveryEvent, EmailRepositoryInterface, EmailSendReservation, ProjectEmailSender } from './email-repository.interface';
import { DailyLimitReachedError, SenderNotApprovedError } from './email-policy-errors';

const EMAIL_RECORD_COLUMNS = 'message_id, provider, status, recipients, recipient_count, sent_at, created_at';

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

  async setProjectSender(sender: ProjectEmailSender): Promise<ProjectEmailSender> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockProject(client, sender.projectId, sender.environment);
      const result = await client.query(
        `INSERT INTO shared_email.project_senders (project_id, environment, from_address, daily_limit)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, environment) DO UPDATE
           SET from_address = EXCLUDED.from_address,
               daily_limit = EXCLUDED.daily_limit,
               updated_at = now()
         RETURNING project_id, environment, from_address, daily_limit`,
        [sender.projectId, sender.environment, sender.fromAddress, sender.dailyLimit],
      );
      await client.query('commit');
      return mapProjectSender(result.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async sendWithinDailyLimit(
    owner: SharedServiceCaller,
    message: EmailSendReservation,
    send: (fromAddress: string) => Promise<string | undefined>,
  ): Promise<EmailRecord> {
    const reservation = await this.reserve(owner, message);
    let providerMessageId: string | undefined;
    try {
      providerMessageId = await send(reservation.fromAddress);
    } catch (error) {
      // If this update also fails, the row stays 'pending' and keeps counting toward the limit.
      await this.markFailed(reservation.messageId, owner).catch(() => undefined);
      throw error;
    }
    return this.markQueued(reservation.messageId, providerMessageId ?? reservation.messageId, owner);
  }

  /** Checks the sender and the UTC-day limit, then inserts a 'pending' row, in one short transaction under the project lock. */
  private async reserve(owner: SharedServiceCaller, message: EmailSendReservation): Promise<{ messageId: string; fromAddress: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.lockProject(client, owner.projectId, owner.environment);
      const config = await client.query(
        `SELECT from_address, daily_limit
           FROM shared_email.project_senders
          WHERE project_id = $1 AND environment = $2`,
        [owner.projectId, owner.environment],
      );
      const fromAddress: string = config.rows[0]?.from_address ?? message.defaultFrom;
      if (message.requestedFrom !== undefined && message.requestedFrom !== fromAddress) throw new SenderNotApprovedError();
      const dailyLimit = Number(config.rows[0]?.daily_limit ?? message.defaultDailyLimit);
      const count = await client.query(
        `SELECT count(*)::int AS count
           FROM shared_email.email_messages
          WHERE project_id = $1 AND environment = $2
            AND status <> 'failed'
            AND created_at >= date_trunc('day', now(), 'UTC')
            AND created_at < date_trunc('day', now(), 'UTC') + interval '1 day'`,
        [owner.projectId, owner.environment],
      );
      if (Number(count.rows[0]?.count ?? 0) >= dailyLimit) throw new DailyLimitReachedError();
      const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
      await client.query(
        `INSERT INTO shared_email.email_messages
           (message_id, tribe_id, project_id, service_id, environment, provider, status, recipients, recipient_count, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, now())`,
        [
          messageId, owner.tribeId, owner.projectId, owner.serviceId, owner.environment,
          message.provider, message.recipients, message.recipients.length,
        ],
      );
      await client.query('commit');
      return { messageId, fromAddress };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async applyDeliveryEvent(event: EmailDeliveryEvent): Promise<{ duplicate: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        `INSERT INTO shared_email.email_delivery_events (provider_event_id, message_id, status, payload)
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
        `UPDATE shared_email.email_messages SET status = $2, updated_at = now() WHERE message_id = $1 RETURNING message_id`,
        [event.messageId, event.status],
      );
      if (updated.rowCount === 0) throw new Error('Email message is not yet recorded');
      await client.query('commit');
      return { duplicate: false };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Swaps in the provider's message ID so delivery events can find the message. */
  private async markQueued(localId: string, messageId: string, owner: SharedServiceCaller): Promise<EmailRecord> {
    const result = await this.pool.query(
      `UPDATE shared_email.email_messages
          SET message_id = $4, status = 'queued', sent_at = now(), updated_at = now()
        WHERE message_id = $1 AND project_id = $2 AND environment = $3
        RETURNING ${EMAIL_RECORD_COLUMNS}`,
      [localId, owner.projectId, owner.environment, messageId],
    );
    if (result.rowCount === 0) throw new Error('Reserved email message is missing');
    return mapEmailRecord(result.rows[0]);
  }

  private async markFailed(localId: string, owner: SharedServiceCaller): Promise<void> {
    await this.pool.query(
      `UPDATE shared_email.email_messages
          SET status = 'failed', updated_at = now()
        WHERE message_id = $1 AND project_id = $2 AND environment = $3`,
      [localId, owner.projectId, owner.environment],
    );
  }

  private async lockProject(client: PoolClient, projectId: string, environment: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${projectId}:${environment}`]);
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null> {
    const result = await this.pool.query(
      `SELECT ${EMAIL_RECORD_COLUMNS}
         FROM shared_email.email_messages
        WHERE message_id = $1 AND project_id = $2 AND environment = $3`,
      [messageId, owner.projectId, owner.environment],
    );
    return result.rows.length === 0 ? null : mapEmailRecord(result.rows[0]);
  }
}

function mapEmailRecord(row: Record<string, any>): EmailRecord {
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

function mapProjectSender(row: Record<string, unknown>): ProjectEmailSender {
  return {
    projectId: String(row.project_id),
    environment: row.environment as ProjectEmailSender['environment'],
    fromAddress: String(row.from_address),
    dailyLimit: row.daily_limit === null ? null : Number(row.daily_limit),
  };
}
