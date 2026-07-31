import { Pool } from 'pg';
import { OtpRecord } from './otp-store';
import { OtpRepositoryInterface } from './otp-repository.interface';

export class PostgresOtpStore implements OtpRepositoryInterface {
  private readonly pool: Pool;
  private initialized = false;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL || process.env.OTP_DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS shared_otp;
        CREATE TABLE IF NOT EXISTS shared_otp.otp_records (
          otp_id VARCHAR(64) PRIMARY KEY,
          target VARCHAR(255) NOT NULL,
          channel VARCHAR(16) NOT NULL,
          code VARCHAR(32) NOT NULL,
          expires_at BIGINT NOT NULL,
          status VARCHAR(32) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_otp_target ON shared_otp.otp_records(target);
      `);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  async save(record: OtpRecord): Promise<OtpRecord> {
    await this.ensureInitialized();
    const query = `
      INSERT INTO shared_otp.otp_records (otp_id, target, channel, code, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (otp_id) DO UPDATE SET
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at;
    `;
    await this.pool.query(query, [
      record.otpId,
      record.target,
      record.channel,
      record.code,
      record.expiresAt,
      record.status,
    ]);
    return record;
  }

  async findById(otpId: string): Promise<OtpRecord | null> {
    await this.ensureInitialized();
    const result = await this.pool.query(
      `SELECT otp_id, target, channel, code, expires_at, status FROM shared_otp.otp_records WHERE otp_id = $1`,
      [otpId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      otpId: row.otp_id,
      target: row.target,
      channel: row.channel,
      code: row.code,
      expiresAt: Number(row.expires_at),
      status: row.status,
    };
  }

  async update(otpId: string, patch: Partial<OtpRecord>): Promise<OtpRecord | null> {
    const existing = await this.findById(otpId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await this.save(updated);
    return updated;
  }
}
