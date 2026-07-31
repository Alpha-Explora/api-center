import { PayMongoError } from './payment-errors';

export interface CheckoutRecord {
  checkoutId: string;
  provider: string;
  status: string;
  referenceId?: string;
  redirectUrl?: string;
  expiresAt?: string;
  amount?: any;
  tribeId?: string;
  cancellationReason?: string;
  createdAt: string;
}

export class MemoryPaymentStore {
  private static instance: MemoryPaymentStore;
  private readonly checkouts = new Map<string, CheckoutRecord>();
  public readonly enabled = true;

  public static getInstance(): MemoryPaymentStore {
    if (!MemoryPaymentStore.instance) {
      MemoryPaymentStore.instance = new MemoryPaymentStore();
    }
    return MemoryPaymentStore.instance;
  }

  async saveCheckoutSession(record: CheckoutRecord): Promise<CheckoutRecord> {
    this.checkouts.set(record.checkoutId, record);
    return record;
  }

  async getCheckoutSessionStatus(checkoutId: string): Promise<CheckoutRecord | null> {
    return this.checkouts.get(checkoutId) || null;
  }

  async getCheckoutSessionByReference(referenceId: string, tribeId?: string): Promise<CheckoutRecord | null> {
    for (const record of this.checkouts.values()) {
      if (record.referenceId === referenceId && (!tribeId || record.tribeId === tribeId)) {
        return record;
      }
    }
    return null;
  }

  async updateCheckoutStatus(checkoutId: string, patch: Partial<CheckoutRecord>): Promise<CheckoutRecord | null> {
    const existing = this.checkouts.get(checkoutId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.checkouts.set(checkoutId, updated);
    return updated;
  }
}

export function assertTribeCanRead(stored: CheckoutRecord, tribeId?: string) {
  if (tribeId && stored.tribeId && stored.tribeId !== tribeId) {
    throw new PayMongoError('Checkout session belongs to a different tribe.', 403, 'FORBIDDEN');
  }
}
