import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameProject } from '@apicenter/runtime';
import { PostgresSmsStore } from './postgres-sms-store';
import type { SmsRepositoryInterface } from './sms-repository.interface';
import type { ProviderMessage, SmsDeliveryEvent } from './sms-repository.interface';
import type { ProjectSmsSender } from './project-sender';

export interface SmsRecord {
  messageId: string;
  to: string;
  message: string;
  status: string;
  senderId?: string;
  createdAt: string;
}

interface OwnedSmsRecord {
  record: SmsRecord;
  owner: SharedServiceCaller;
}

export class MemorySmsStore implements SmsRepositoryInterface {
  private static instance: MemorySmsStore;
  private readonly store = new Map<string, OwnedSmsRecord>();
  private readonly deliveryEventIds = new Set<string>();
  private readonly providerMessageIds = new Map<string, string>();
  private readonly projectSenders = new Map<string, ProjectSmsSender>();

  public static getInstance(): MemorySmsStore {
    if (!MemorySmsStore.instance) {
      MemorySmsStore.instance = new MemorySmsStore();
    }
    return MemorySmsStore.instance;
  }

  async save(record: SmsRecord, owner: SharedServiceCaller, sent?: ProviderMessage): Promise<SmsRecord> {
    const existing = this.store.get(record.messageId);
    if (existing && !sameProject(existing.owner, owner)) {
      throw new Error('SMS message id belongs to another project');
    }
    this.store.set(record.messageId, { record: { ...record }, owner: { ...(existing?.owner ?? owner) } });
    if (sent && !this.providerMessageIds.has(`${sent.provider}:${sent.id}`)) {
      this.providerMessageIds.set(`${sent.provider}:${sent.id}`, record.messageId);
    }
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null> {
    const entry = this.store.get(messageId);
    if (!entry || !sameProject(entry.owner, owner)) return null;
    return { ...entry.record };
  }

  async applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }> {
    if (this.deliveryEventIds.has(event.providerEventId)) return { duplicate: true };
    const messageId = this.providerMessageIds.get(`${event.provider}:${event.providerMessageId}`);
    const entry = messageId ? this.store.get(messageId) : undefined;
    if (!messageId || !entry) throw new Error('SMS message is not yet recorded');
    this.deliveryEventIds.add(event.providerEventId);
    this.store.set(messageId, { ...entry, record: { ...entry.record, status: event.status } });
    return { duplicate: false };
  }

  async getProjectSender(projectId: string, environment: ProjectSmsSender['environment']): Promise<ProjectSmsSender | null> {
    const sender = this.projectSenders.get(`${projectId}:${environment}`);
    return sender ? { ...sender } : null;
  }

  async setProjectSender(sender: ProjectSmsSender): Promise<ProjectSmsSender> {
    this.projectSenders.set(`${sender.projectId}:${sender.environment}`, { ...sender });
    return { ...sender };
  }
}

/** Uses Postgres when DATABASE_URL is set. Production refuses to start without it. */
export function createSmsRepository(): SmsRepositoryInterface {
  if (process.env.DATABASE_URL) return new PostgresSmsStore();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the SMS record store in production');
  }
  return MemorySmsStore.getInstance();
}
