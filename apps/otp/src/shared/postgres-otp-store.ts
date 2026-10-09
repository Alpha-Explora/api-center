import { Pool } from 'pg';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { OtpRecord } from './otp-store';
import type { OtpRepositoryInterface } from './otp-repository.interface';

export class PostgresOtpStore implements OtpRepositoryInterface {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  /** Records the creating caller. A later save may update only a challenge in the same project and environment. */
  async save(record: OtpRecord, owner: SharedServiceCaller): Promise<OtpRecord> {
    const result = await this.pool.query(
      `INSERT INTO shared_otp.otp_challenges AS c
         (otp_id, tribe_id, project_id, service_id, environment, channel, target, code_hash, status, attempt_count, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (otp_id) DO UPDATE SET
         status = EXCLUDED.status, expires_at = EXCLUDED.expires_at,
         attempt_count = EXCLUDED.attempt_count, updated_at = now()
         WHERE c.project_id = EXCLUDED.project_id AND c.environment = EXCLUDED.environment
       RETURNING otp_id`,
      [
        record.otpId, owner.tribeId, owner.projectId, owner.serviceId, owner.environment,
        record.channel, record.target, record.codeHash, record.status, record.attemptCount,
        new Date(record.expiresAt),
      ],
    );
    if (result.rowCount === 0) throw new Error('OTP challenge id belongs to another project');
    return record;
  }

  async findById(otpId: string, owner: SharedServiceCaller): Promise<OtpRecord | null> {
    const result = await this.pool.query(
      `SELECT otp_id, target, channel, code_hash, expires_at, status, attempt_count
         FROM shared_otp.otp_challenges
        WHERE otp_id = $1 AND project_id = $2 AND environment = $3`,
      [otpId, owner.projectId, owner.environment],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      otpId: row.otp_id,
      target: row.target,
      channel: row.channel,
      codeHash: row.code_hash,
      expiresAt: new Date(row.expires_at).getTime(),
      status: row.status,
      attemptCount: Number(row.attempt_count),
    };
  }

  async update(otpId: string, patch: Partial<OtpRecord>, owner: SharedServiceCaller): Promise<OtpRecord | null> {
    const existing = await this.findById(otpId, owner);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await this.save(updated, owner);
    return updated;
  }

  /**
   * One statement counts the attempt and marks the challenge used only when the hash matches.
   * Concurrent verifications wait on the row lock, so exactly one of them can succeed.
   */
  async consume(otpId: string, codeHash: string, owner: SharedServiceCaller): Promise<string> {
    const result = await this.pool.query(
      `UPDATE shared_otp.otp_challenges
          SET attempt_count = attempt_count + 1,
              status = CASE WHEN code_hash = $2 THEN 'used' ELSE status END,
              updated_at = now()
        WHERE otp_id = $1 AND project_id = $3 AND environment = $4
          AND status = 'pending' AND expires_at > $5
       RETURNING code_hash = $2 AS matched`,
      [otpId, codeHash, owner.projectId, owner.environment, new Date()],
    );
    if (result.rowCount) return result.rows[0].matched ? 'VERIFIED' : 'OTP_INVALID';

    const record = await this.findById(otpId, owner);
    if (!record) return 'OTP_NOT_FOUND';
    if (record.status === 'used') return 'OTP_ALREADY_USED';
    if (record.status === 'expired' || Date.now() > record.expiresAt) return 'OTP_EXPIRED';
    return 'OTP_INVALID';
  }
}
