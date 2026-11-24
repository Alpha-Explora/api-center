import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PayMongoError } from '../../shared/payment-errors';
import type { PaymentContext } from '../../shared/payment-owner-store';
import type { WalletAccount } from '../payouts/merchant-accounts';
import { isSandboxAccountId, type AccountEvent } from './account-events';
import { attachConsumerWallet, detachConsumerWallet, recordConsumerStatus } from './consumer-wallet-effects';
import { applyEvent, initialState, type LinkedAccountState, type ProviderAccountId } from './linked-account-lifecycle';

type Environment = PaymentContext['environment'];
export type LinkedAccountContext = PaymentContext & { payeeId?: string };
export type LinkedAccountRecord = LinkedAccountState & {
  id: string;
  environment: Environment;
  projectId: string;
  organizationId: string;
  payeeId: string | null;
  onboardingApplicationId: string | null;
  onboardingVersion: number;
  closedAt: Date | null;
  createStartedAt: Date | null;
  verificationSessionId: string | null;
};

type AccountRow = {
  id: string;
  environment: Environment;
  project_id: string;
  organization_id: string;
  payee_id: string | null;
  onboarding_application_id: string | null;
  onboarding_version: number;
  status: LinkedAccountState['status'];
  provider_account_id: ProviderAccountId | null;
  verification_attempts: number;
  verification_expires_at: Date | null;
  wallet_only: boolean;
  activation_requested: boolean;
  decline_reason: string | null;
  payment_methods_requested: boolean;
  closed_at: Date | null;
  create_started_at: Date | null;
  verification_session_id: string | null;
};

function fromRow(row: AccountRow): LinkedAccountRecord {
  return {
    id: row.id, environment: row.environment, projectId: row.project_id, organizationId: row.organization_id, status: row.status,
    payeeId: row.payee_id, onboardingApplicationId: row.onboarding_application_id, onboardingVersion: row.onboarding_version,
    providerAccountId: row.provider_account_id, attempts: row.verification_attempts,
    verificationExpiresAt: row.verification_expires_at, walletOnly: row.wallet_only,
    activationRequested: row.activation_requested, declineReason: row.decline_reason,
    paymentMethodsRequested: row.payment_methods_requested, closedAt: row.closed_at,
    createStartedAt: row.create_started_at, verificationSessionId: row.verification_session_id,
  };
}

export class LinkedAccountStore {
  private readonly records = new Map<string, LinkedAccountRecord>();
  private readonly events = new Set<string>();
  private readonly sessions = new Map<string, Set<string>>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly pool?: Pool, private readonly allowTestWallet = () => false) {}

  async current(context: LinkedAccountContext, query: PoolClient | Pool | undefined = this.pool): Promise<LinkedAccountRecord | null> {
    if (!query) {
      const records = [...this.records.values()].reverse().filter((record) => record.environment === context.environment
        && record.projectId === context.projectId && record.organizationId === context.tribeId && !record.closedAt
        && record.payeeId === (context.payeeId ?? null));
      return records.find((record) => record.status !== 'declined') ?? records[0] ?? null;
    }
    const result = await query.query<AccountRow>(
      `SELECT * FROM shared_payment.linked_accounts WHERE environment = $1 AND project_id = $2 AND organization_id = $3 AND closed_at IS NULL
        AND payee_id IS NOT DISTINCT FROM $4
        ORDER BY (status <> 'declined') DESC, created_at DESC, id DESC LIMIT 1`,
      [context.environment, context.projectId, context.tribeId, context.payeeId ?? null],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async open(context: LinkedAccountContext, query?: PoolClient): Promise<LinkedAccountRecord> {
    const current = await this.current(context, query ?? this.pool);
    if (current && current.status !== 'declined') return current;
    const id = `lac_${randomUUID().replaceAll('-', '')}`;
    const payeeId = context.payeeId ?? null;
    const applicationId = payeeId ? context.consumerServiceId : null;
    if (query) {
      const result = await query.query<AccountRow>(
        `INSERT INTO shared_payment.linked_accounts
          (id, environment, organization_id, project_id, payee_id, onboarding_application_id)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id, context.environment, context.tribeId, context.projectId, payeeId, applicationId],
      );
      return fromRow(result.rows[0]);
    }
    const draft: LinkedAccountRecord = { ...initialState(), id, environment: context.environment, projectId: context.projectId,
      organizationId: context.tribeId, payeeId, onboardingApplicationId: applicationId, onboardingVersion: 0,
      closedAt: null, createStartedAt: null, verificationSessionId: null };
    this.records.set(id, draft);
    return draft;
  }

  async save(record: LinkedAccountRecord, query?: PoolClient): Promise<void> {
    if (!query) {
      this.records.set(record.id, record);
      return;
    }
    const result = await query.query<{ onboarding_version: number }>(
      `UPDATE shared_payment.linked_accounts SET provider_account_id = $2, status = $3, verification_attempts = $4,
        verification_expires_at = $5, wallet_only = $6, activation_requested = $7, decline_reason = $8,
        payment_methods_requested = $9, closed_at = $10, create_started_at = $11, verification_session_id = $12,
        onboarding_version = onboarding_version + CASE WHEN payee_id IS NOT NULL AND status IS DISTINCT FROM $3 THEN 1 ELSE 0 END,
        updated_at = now() WHERE id = $1 RETURNING onboarding_version`,
      [record.id, record.providerAccountId, record.status, record.attempts, record.verificationExpiresAt, record.walletOnly,
        record.activationRequested, record.declineReason, record.paymentMethodsRequested, record.closedAt,
        record.createStartedAt, record.verificationSessionId],
    );
    const version = result.rows[0]?.onboarding_version;
    if (record.payeeId && version > record.onboardingVersion) await recordConsumerStatus(query, record, version);
  }

  async addVerificationSession(record: LinkedAccountRecord, sessionId: string, query?: PoolClient): Promise<boolean> {
    if (!query) {
      const sessions = this.sessions.get(record.id) ?? new Set<string>();
      if (sessions.has(sessionId)) return false;
      sessions.add(sessionId);
      this.sessions.set(record.id, sessions);
      return true;
    }
    const result = await query.query(
      `INSERT INTO shared_payment.linked_account_verification_sessions (linked_account_id, session_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [record.id, sessionId],
    );
    return result.rowCount === 1;
  }

  private async eventAccount(environment: Environment, event: AccountEvent, query?: PoolClient | Pool) {
    const sandbox = isSandboxAccountId(event.providerAccountId);
    if (sandbox && (environment !== 'test' || !event.sessionId)) return undefined;
    if (!query) {
      const matches = [...this.records.values()].filter((record) => record.environment === environment
        && record.providerAccountId === event.providerAccountId
        && (!event.sessionId || this.sessions.get(record.id)?.has(event.sessionId)));
      return matches.length === 1 ? matches[0] : undefined;
    }
    const result = await query.query<AccountRow>(
      `SELECT a.* FROM shared_payment.linked_accounts a
        WHERE a.environment = $1 AND a.provider_account_id = $2
        AND ($3::text IS NULL OR EXISTS (
          SELECT 1 FROM shared_payment.linked_account_verification_sessions s
          WHERE s.linked_account_id = a.id AND s.session_id = $3
        )) LIMIT 2`,
      [environment, event.providerAccountId, event.sessionId ?? null],
    );
    return result.rows.length === 1 ? fromRow(result.rows[0]) : undefined;
  }

  async applyProviderEvent(environment: Environment, event: AccountEvent): Promise<'applied' | 'duplicate' | 'unknown_account'> {
    // A real merchant can be found before its in-flight link transaction commits.
    const accountLookup = isSandboxAccountId(event.providerAccountId) ? event : { ...event, sessionId: undefined };
    const candidate = await this.eventAccount(environment, accountLookup, this.pool);
    if (!candidate) return 'unknown_account';
    return this.lock(environment, candidate.projectId, async (query) => {
      const record = await this.eventAccount(environment, event, query);
      if (!record || record.id !== candidate.id) return 'unknown_account';
      const kind = record.payeeId ? 'consumer' : 'merchant';
      if ((event.accountKind && event.accountKind !== kind) || (record.payeeId && environment !== 'test')) return 'unknown_account';
      if (record.payeeId && event.event.type === 'activated'
        && !['activation_pending', 'active'].includes(record.status)) return 'unknown_account';
      if (query) {
        const result = await query.query(
          `INSERT INTO shared_payment.linked_account_events (environment, provider_event_id, linked_account_id, type)
            VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [environment, event.providerEventId, record.id, event.event.type],
        );
        if (!result.rowCount) return 'duplicate';
      } else {
        const key = `${environment}:${event.providerEventId}`;
        if (this.events.has(key)) return 'duplicate';
        this.events.add(key);
      }
      if (record.closedAt || (event.event.type === 'verification_failed' && record.verificationSessionId !== event.sessionId)) {
        return 'applied';
      }
      const next = applyEvent(record, event.event);
      if (next !== record) await this.save({ ...record, ...next }, query);
      if (record.payeeId) {
        if (query && event.event.type === 'activated' && next.status === 'active' && event.event.wallet
          && !isSandboxAccountId(event.providerAccountId) && this.allowTestWallet()) {
          await attachConsumerWallet(query, record, event.event.wallet);
        }
        if (query && event.event.type === 'declined') await detachConsumerWallet(query, record);
        return 'applied';
      }
      if (query && event.event.type === 'activated' && next.status === 'active' && !isSandboxAccountId(event.providerAccountId)) {
        await query.query(
          `INSERT INTO shared_payment.merchant_accounts AS account
            (environment, id, kind, wallet_account_number, wallet_account_name, linked_account_id)
            VALUES ($1,$2,'child',$3,$4,$5) ON CONFLICT (environment, id) DO UPDATE SET
            wallet_account_number = COALESCE(EXCLUDED.wallet_account_number, account.wallet_account_number),
            wallet_account_name = COALESCE(EXCLUDED.wallet_account_name, account.wallet_account_name), updated_at = now()
            WHERE account.linked_account_id = EXCLUDED.linked_account_id`,
          [environment, event.providerAccountId, event.event.wallet?.number ?? null, event.event.wallet?.name ?? null, record.id],
        );
      }
      if (query && event.event.type === 'declined') await this.disable(record, query);
      return 'applied';
    });
  }

  async hasWallet(record: LinkedAccountRecord, query: Pool | PoolClient | undefined = this.pool): Promise<boolean> {
    if (!query) return false;
    const result = await query.query(
      `SELECT 1 FROM shared_payment.merchant_accounts WHERE environment = $1 AND id = $2
        AND linked_account_id = $3 AND status = 'active' AND wallet_account_number IS NOT NULL
        AND wallet_account_name IS NOT NULL`, [record.environment, record.providerAccountId, record.id],
    );
    return result.rowCount === 1;
  }

  async move(record: LinkedAccountRecord, accountId: 'parent' | ProviderAccountId,
    query?: PoolClient, discoveredWallet?: WalletAccount | null): Promise<void> {
    if (!query) throw new PayMongoError('Project routing requires persistent storage', 503, 'LINKED_ACCOUNTS_STORAGE_REQUIRED');
    if (accountId !== 'parent') {
      if (discoveredWallet) {
        await query.query(
          `UPDATE shared_payment.merchant_accounts SET wallet_account_number = $4, wallet_account_name = $5, updated_at = now()
            WHERE environment = $1 AND id = $2 AND linked_account_id = $3 AND status = 'active'
              AND (wallet_account_number IS NULL OR wallet_account_name IS NULL)`,
          [record.environment, accountId, record.id, discoveredWallet.number, discoveredWallet.name],
        );
      }
      if (!await this.hasWallet(record, query)) {
        throw new PayMongoError('The linked account wallet is unavailable', 409, 'WALLET_NOT_CONFIGURED');
      }
    }
    await query.query(
      `INSERT INTO shared_payment.project_merchant_accounts (environment, project_id, effective_from, merchant_account_id)
        VALUES ($1,$2,clock_timestamp(),$3)`, [record.environment, record.projectId, accountId],
    );
  }

  async close(record: LinkedAccountRecord, query?: PoolClient): Promise<void> {
    if (record.status === 'draft' && record.createStartedAt) {
      throw new PayMongoError('Reconcile account creation before closing onboarding', 409, 'LINKED_ACCOUNT_OUTCOME_UNKNOWN');
    }
    if (query && record.providerAccountId) {
      const balance = await query.query(
        `SELECT 1 FROM shared_payment.payout_allocations WHERE environment = $1 AND merchant_account_id = $2
          AND NOT template AND status IN ('awaiting_payment', 'held', 'released', 'pooled') LIMIT 1`,
        [record.environment, record.providerAccountId],
      );
      if (balance.rowCount) throw new PayMongoError('Account still has unpaid allocations', 409, 'ACCOUNT_HAS_BALANCE');
      await this.disable(record, query);
    }
    await this.save({ ...record, closedAt: new Date() }, query);
  }

  private async disable(record: LinkedAccountRecord, query: PoolClient) {
    await query.query(
      `UPDATE shared_payment.merchant_accounts SET status = 'disabled', updated_at = now()
        WHERE environment = $1 AND linked_account_id = $2`, [record.environment, record.id],
    );
  }

  async lock<T>(environment: Environment, projectId: string, work: (query?: PoolClient) => Promise<T>): Promise<T> {
    const key = JSON.stringify(['linked-account', environment, projectId]);
    if (!this.pool) {
      const previous = this.locks.get(key);
      const result = (previous ?? Promise.resolve()).catch(() => undefined).then(() => work());
      this.locks.set(key, result);
      try { return await result; } finally { if (this.locks.get(key) === result) this.locks.delete(key); }
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
