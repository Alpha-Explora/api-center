import { Pool, type PoolClient } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';
import type { EmailRepositoryInterface } from './email-repository.interface';
import type { ProjectEmailSender } from './email-repository.interface';
import { DailyLimitReachedError, SenderNotApprovedError } from './email-policy-errors';

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
    await this.insertRecord(this.pool, record, owner);
    return record;
  }

  private async insertRecord(client: Pick<PoolClient, 'query'> | Pool, record: EmailRecord, owner: SharedServiceCaller): Promise<void> {
    const result = await client.query(
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
    requestedFrom: string | undefined,
    defaultFrom: string,
    defaultDailyLimit: number,
    send: (fromAddress: string) => Promise<EmailRecord>,
  ): Promise<EmailRecord> {
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
      const fromAddress = config.rows[0]?.from_address ?? defaultFrom;
      if (requestedFrom !== undefined && requestedFrom !== fromAddress) throw new SenderNotApprovedError();
      const dailyLimit = config.rows[0]?.daily_limit ?? defaultDailyLimit;
      const count = await client.query(
        `SELECT count(*)::int AS count
           FROM shared_email.email_messages
          WHERE project_id = $1 AND environment = $2
            AND created_at >= $3 AND created_at < $4`,
        [owner.projectId, owner.environment, ...utcDayBounds()],
      );
      if (Number(count.rows[0]?.count ?? 0) >= Number(dailyLimit)) throw new DailyLimitReachedError();
      const record = await send(fromAddress);
      await this.insertRecord(client, record, owner);
      await client.query('commit');
      return record;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockProject(client: PoolClient, projectId: string, environment: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${projectId}:${environment}`]);
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

function utcDayBounds(now = new Date()): [Date, Date] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return [start, end];
}

function mapProjectSender(row: Record<string, unknown>): ProjectEmailSender {
  return {
    projectId: String(row.project_id),
    environment: row.environment as ProjectEmailSender['environment'],
    fromAddress: String(row.from_address),
    dailyLimit: row.daily_limit === null ? null : Number(row.daily_limit),
  };
}
