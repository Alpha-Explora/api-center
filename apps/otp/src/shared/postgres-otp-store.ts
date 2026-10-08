import { Pool } from 'pg';
import { OtpRecord } from './otp-store';
import { OtpRepositoryInterface } from './otp-repository.interface';

export class PostgresOtpStore implements OtpRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL || process.env.OTP_DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async save(record: OtpRecord): Promise<OtpRecord> {
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
      record.codeHash,
      record.expiresAt,
      record.status,
    ]);
    return record;
  }

  async findById(otpId: string): Promise<OtpRecord | null> {
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
      codeHash: row.code,
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

  async consume(otpId: string, codeHash: string): Promise<string> {
    const result = await this.pool.query(
      `UPDATE shared_otp.otp_records SET status = 'used'
       WHERE otp_id = $1 AND code = $2 AND status = 'pending' AND expires_at > $3
       RETURNING otp_id`,
      [otpId, codeHash, Date.now()],
    );
    if (result.rowCount) return 'VERIFIED';
    const record = await this.findById(otpId);
    if (!record) return 'OTP_NOT_FOUND';
    if (record.status === 'used') return 'OTP_ALREADY_USED';
    if (record.status === 'expired' || Date.now() > record.expiresAt) return 'OTP_EXPIRED';
    return 'OTP_INVALID';
  }
}
