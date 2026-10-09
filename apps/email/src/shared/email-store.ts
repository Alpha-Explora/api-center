import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameProject } from '@apicenter/runtime';
import type { EmailRepositoryInterface } from './email-repository.interface';
import type { ProjectEmailSender } from './email-repository.interface';
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
    const prior = this.projectLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => lock);
    this.projectLocks.set(key, queued);
    await prior;
    try {
      this.projectSenders.set(key, { ...sender });
      return { ...sender };
    } finally {
      release();
      if (this.projectLocks.get(key) === queued) this.projectLocks.delete(key);
    }
  }

  async sendWithinDailyLimit(
    owner: SharedServiceCaller,
    requestedFrom: string | undefined,
    defaultFrom: string,
    defaultDailyLimit: number,
    send: (fromAddress: string) => Promise<EmailRecord>,
  ): Promise<EmailRecord> {
    const key = `${owner.projectId}:${owner.environment}`;
    const prior = this.projectLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => lock);
    this.projectLocks.set(key, queued);
    await prior;
    try {
      const config = this.projectSenders.get(key);
      const fromAddress = config?.fromAddress ?? defaultFrom;
      if (requestedFrom !== undefined && requestedFrom !== fromAddress) throw new SenderNotApprovedError();
      const dailyLimit = config?.dailyLimit ?? defaultDailyLimit;
      const now = new Date();
      const utcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const count = [...this.store.values()].filter(({ owner: messageOwner, record }) =>
        messageOwner.projectId === owner.projectId && messageOwner.environment === owner.environment &&
        new Date(record.createdAt) >= utcStart,
      ).length;
      if (count >= dailyLimit) throw new DailyLimitReachedError();
      const record = await send(fromAddress);
      await this.save(record, owner);
      return record;
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
