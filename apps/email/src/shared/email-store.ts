import { randomUUID } from 'node:crypto';
import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameProject } from '@apicenter/runtime';
import type { EmailRepositoryInterface, EmailSendReservation, ProjectEmailSender } from './email-repository.interface';
import { PostgresEmailStore } from './postgres-email-store';
import { DailyLimitReachedError, SenderNotApprovedError } from './email-policy-errors';

export interface EmailRecord {
  messageId: string;
  provider: string;
  status: string;
  recipient: string[];
  recipientCount: number;
  sentAt: string;
  createdAt: string;
}

interface OwnedEmailRecord {
  record: EmailRecord;
  owner: SharedServiceCaller;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class MemoryEmailStore implements EmailRepositoryInterface {
  private static instance: MemoryEmailStore;
  private readonly store = new Map<string, OwnedEmailRecord>();
  private readonly projectSenders = new Map<string, ProjectEmailSender>();
  private readonly projectLocks = new Map<string, Promise<void>>();

  public static getInstance(): MemoryEmailStore {
    if (!MemoryEmailStore.instance) {
      MemoryEmailStore.instance = new MemoryEmailStore();
    }
    return MemoryEmailStore.instance;
  }

  async save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord> {
    const existing = this.store.get(record.messageId);
    if (existing && !sameProject(existing.owner, owner)) {
      throw new Error('Email message id belongs to another project');
    }
    this.store.set(record.messageId, { record: { ...record }, owner: { ...(existing?.owner ?? owner) } });
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null> {
    const entry = this.store.get(messageId);
    if (!entry || !sameProject(entry.owner, owner)) return null;
    return { ...entry.record };
  }

  async setProjectSender(sender: ProjectEmailSender): Promise<ProjectEmailSender> {
    const key = `${sender.projectId}:${sender.environment}`;
    return this.withProjectLock(key, () => {
      this.projectSenders.set(key, { ...sender });
      return { ...sender };
    });
  }

  async sendWithinDailyLimit(
    owner: SharedServiceCaller,
    message: EmailSendReservation,
    send: (fromAddress: string) => Promise<string | undefined>,
  ): Promise<EmailRecord> {
    const key = `${owner.projectId}:${owner.environment}`;
    const reservation = await this.withProjectLock(key, () => this.reserve(key, owner, message));
    let providerMessageId: string | undefined;
    try {
      providerMessageId = await send(reservation.fromAddress);
    } catch (error) {
      this.markFailed(reservation.messageId, owner);
      throw error;
    }
    return this.markQueued(reservation.messageId, providerMessageId ?? reservation.messageId, owner);
  }

  /** Checks the sender and the UTC-day limit, then stores a 'pending' message. Callers hold the project lock. */
  private reserve(key: string, owner: SharedServiceCaller, message: EmailSendReservation): { messageId: string; fromAddress: string } {
    const config = this.projectSenders.get(key);
    const fromAddress = config?.fromAddress ?? message.defaultFrom;
    if (message.requestedFrom !== undefined && message.requestedFrom !== fromAddress) throw new SenderNotApprovedError();
    const dailyLimit = config?.dailyLimit ?? message.defaultDailyLimit;
    const now = new Date();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const count = [...this.store.values()].filter(({ owner: messageOwner, record }) => {
      const createdAt = Date.parse(record.createdAt);
      return sameProject(messageOwner, owner) && record.status !== 'failed' &&
        createdAt >= dayStart && createdAt < dayStart + DAY_MS;
    }).length;
    if (count >= dailyLimit) throw new DailyLimitReachedError();
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
    const timestamp = now.toISOString();
    this.store.set(messageId, {
      record: {
        messageId,
        provider: message.provider,
        status: 'pending',
        recipient: [...message.recipients],
        recipientCount: message.recipients.length,
        sentAt: timestamp,
        createdAt: timestamp,
      },
      owner: { ...owner },
    });
    return { messageId, fromAddress };
  }

  private markQueued(localId: string, messageId: string, owner: SharedServiceCaller): EmailRecord {
    const entry = this.store.get(localId);
    if (!entry || !sameProject(entry.owner, owner)) throw new Error('Reserved email message is missing');
    if (messageId !== localId && this.store.has(messageId)) throw new Error('Email message id is already recorded');
    const record = { ...entry.record, messageId, status: 'queued', sentAt: new Date().toISOString() };
    this.store.delete(localId);
    this.store.set(messageId, { record, owner: entry.owner });
    return { ...record };
  }

  private markFailed(localId: string, owner: SharedServiceCaller): void {
    const entry = this.store.get(localId);
    if (entry && sameProject(entry.owner, owner)) {
      this.store.set(localId, { ...entry, record: { ...entry.record, status: 'failed' } });
    }
  }

  /** Runs fn after earlier holders of the same project lock finish. */
  private async withProjectLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prior = this.projectLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => lock);
    this.projectLocks.set(key, queued);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.projectLocks.get(key) === queued) this.projectLocks.delete(key);
    }
  }
}

/** Uses Postgres when DATABASE_URL is set. Production refuses to start without it. */
export function createEmailStore(): EmailRepositoryInterface {
  if (process.env.DATABASE_URL) return new PostgresEmailStore();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the email record store in production');
  }
  return MemoryEmailStore.getInstance();
}
