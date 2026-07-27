const {
  assertCanonicalStatus,
  assertCanonicalSubscriptionStatus,
  normalizeCheckoutEntry,
  normalizeCustomerEntry,
  normalizeInvoiceEntry,
  normalizePriceEntry,
  normalizeProductEntry,
  normalizeSubscriptionEntry,
  referenceKey,
  tenantScoped,
  webhookEventKey,
} = require('./paymentStore.common');

function createMemoryPaymentStore() {
  const checkouts = new Map();
  const references = new Map();
  const webhookEvents = new Map();
  const outboxEvents = new Map();
  const payments = new Map();
  const refunds = new Map();
  const customers = new Map();
  const products = new Map();
  const prices = new Map();
  const subscriptions = new Map();
  const subscriptionReferences = new Map();
  const subscriptionEvents = new Set();
  const invoices = new Map();

  return {
    enabled: true,

    async createCheckoutSessionRecord(entry) {
      const normalized = {
        ...normalizeCheckoutEntry(entry),
        aggregateVersion: entry.aggregateVersion || 1,
      };
      checkouts.set(normalized.checkoutId, normalized);
      if (normalized.referenceId && normalized.tribeId) {
        references.set(referenceKey(normalized.referenceId, normalized.tribeId), normalized.checkoutId);
      }
      return normalized;
    },

    async getCheckoutSessionStatus(checkoutId) {
      return checkouts.get(checkoutId) || null;
    },

    async getCheckoutSessionByReference(referenceId, tribeId) {
      const checkoutId = references.get(referenceKey(referenceId, tribeId));
      return checkoutId ? checkouts.get(checkoutId) || null : null;
    },

    async updateCheckoutStatus(checkoutId, patch) {
      assertCanonicalStatus(patch.status);
      const current = checkouts.get(checkoutId);
      if (!current) {
        return null;
      }

      const updated = {
        ...current,
        ...patch,
        aggregateVersion: (current.aggregateVersion || 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      checkouts.set(checkoutId, updated);
      return updated;
    },

    async withTransaction(work) {
      return work(null);
    },

    async recordWebhookEvent(event) {
      const key = webhookEventKey(event);
      const existing = webhookEvents.get(key);
      if (existing) return { inserted: false, duplicate: true, status: existing };
      webhookEvents.set(key, event.status || 'received');
      return { inserted: true, duplicate: false, status: event.status || 'received' };
    },

    async markWebhookEventProcessed(providerEventId, environment) {
      const prefix = `${environment}:`;
      const suffix = `:${providerEventId}`;
      const key = Array.from(webhookEvents.keys()).find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix));
      if (key) webhookEvents.set(key, 'processed');
      return { status: 'processed' };
    },


    async enqueuePaymentEvent(event) {
      const key = webhookEventKey(event);
      if (outboxEvents.has(key)) return { inserted: false, duplicate: true };
      const ownerTribeId = event.ownerTribeId || event.payload?.ownerTribeId;
      const consumerServiceId = event.consumerServiceId || event.payload?.consumerServiceId;
      const referenceId = event.referenceId || event.payload?.referenceId;
      const attributed = Boolean(ownerTribeId && consumerServiceId && referenceId);
      const now = new Date();
      outboxEvents.set(key, {
        ...event,
        ownerTribeId,
        consumerServiceId,
        referenceId,
        status: attributed ? 'pending' : 'quarantined',
        quarantineReason: attributed ? null : 'missing_owner_tribe_id_consumer_service_id_or_reference_id',
        quarantineAttempts: 0,
        quarantinedAt: attributed ? null : now.toISOString(),
        quarantineExpiresAt: attributed ? null : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        availableAt: now.toISOString(),
        attempts: 0,
        createdAt: now.toISOString(),
      });
      return attributed
        ? { inserted: true, duplicate: false }
        : { inserted: true, duplicate: false, quarantined: true };
    },

    async claimPendingPaymentEvents(limit = 50) {
      return Array.from(outboxEvents.values())
        .filter((event) => event.status === "pending" || event.status === "retry")
        .slice(0, limit)
        .map((event) => ({ ...event, status: "publishing" }));
    },

    async claimQuarantinedPaymentEvents(limit = 50) {
      const now = Date.now();
      return Array.from(outboxEvents.entries())
        .filter(([, event]) => event.status === 'quarantined'
          && (!event.quarantineExpiresAt || new Date(event.quarantineExpiresAt).getTime() > now)
          && (!event.availableAt || new Date(event.availableAt).getTime() <= now))
        .slice(0, limit)
        .map(([key, event]) => {
          const next = {
            ...event,
            quarantineAttempts: (event.quarantineAttempts || 0) + 1,
            availableAt: new Date(now + 5 * 60 * 1000).toISOString(),
          };
          outboxEvents.set(key, next);
          return next;
        });
    },

    async resolveQuarantinedPaymentEvent(providerEventId, attribution = {}) {
      for (const [key, event] of outboxEvents.entries()) {
        if (event.providerEventId !== providerEventId || event.status !== 'quarantined') continue;
        const ownerTribeId = attribution.ownerTribeId || event.ownerTribeId;
        const consumerServiceId = attribution.consumerServiceId || event.consumerServiceId;
        const referenceId = attribution.referenceId || event.referenceId;
        const payload = { ...event.payload, ownerTribeId, consumerServiceId, referenceId };
        const attributed = Boolean(ownerTribeId && consumerServiceId && referenceId);
        const next = {
          ...event,
          ownerTribeId,
          consumerServiceId,
          referenceId,
          payload,
          status: attributed ? 'pending' : 'quarantined',
          availableAt: new Date().toISOString(),
          quarantineReason: attributed ? null : event.quarantineReason,
        };
        outboxEvents.set(key, next);
        return next;
      }
      return null;
    },
    async markPaymentEventPublished(providerEventId) {
      for (const [key, event] of outboxEvents.entries()) {
        if (event.providerEventId === providerEventId) {
          outboxEvents.set(key, { ...event, status: "published", publishedAt: new Date().toISOString() });
          return outboxEvents.get(key);
        }
      }
      return null;
    },

    async markPaymentEventFailed(providerEventId, error) {
      for (const [key, event] of outboxEvents.entries()) {
        if (event.providerEventId === providerEventId) {
          outboxEvents.set(key, { ...event, status: "retry", attempts: (event.attempts || 0) + 1, lastError: error });
          return outboxEvents.get(key);
        }
      }
      return null;
    },
    async upsertPayment(entry) {
      const current = payments.get(entry.paymentId);
      const updated = { ...entry, aggregateVersion: (current?.aggregateVersion || 0) + 1 };
      payments.set(entry.paymentId, updated);
      return updated;
    },

    async getPaymentByProviderId(paymentId) {
      return payments.get(paymentId) || null;
    },

    async upsertRefund(entry) {
      const current = refunds.get(entry.refundId);
      const updated = { ...entry, aggregateVersion: (current?.aggregateVersion || 0) + 1 };
      refunds.set(entry.refundId, updated);
      return updated;
    },

    async createCustomer(entry) {
      const normalized = normalizeCustomerEntry(entry);
      customers.set(normalized.customerId, normalized);
      return normalized;
    },

    async getCustomer(customerId, tribeId) {
      return tenantScoped(customers.get(customerId), tribeId);
    },

    async createProduct(entry) {
      const normalized = normalizeProductEntry(entry);
      products.set(normalized.productId, normalized);
      return normalized;
    },

    async getProduct(productId, tribeId) {
      return tenantScoped(products.get(productId), tribeId);
    },

    async createPrice(entry) {
      const normalized = normalizePriceEntry(entry);
      prices.set(normalized.priceId, normalized);
      return normalized;
    },

    async getPrice(priceId, tribeId) {
      return tenantScoped(prices.get(priceId), tribeId);
    },

    async createSubscription(entry) {
      const normalized = { ...normalizeSubscriptionEntry(entry), aggregateVersion: entry.aggregateVersion || 1 };
      subscriptions.set(normalized.subscriptionId, normalized);
      if (normalized.referenceId && normalized.tribeId) {
        subscriptionReferences.set(referenceKey(normalized.referenceId, normalized.tribeId), normalized.subscriptionId);
      }
      return normalized;
    },

    async getSubscription(subscriptionId, tribeId) {
      return tenantScoped(subscriptions.get(subscriptionId), tribeId);
    },

    async getSubscriptionByReference(referenceId, tribeId) {
      const subscriptionId = subscriptionReferences.get(referenceKey(referenceId, tribeId));
      return subscriptionId ? tenantScoped(subscriptions.get(subscriptionId), tribeId) : null;
    },

    async updateSubscriptionStatus(subscriptionId, patch) {
      assertCanonicalSubscriptionStatus(patch.status);
      const current = subscriptions.get(subscriptionId);
      if (!current) {
        return null;
      }

      const updated = {
        ...current,
        ...patch,
        aggregateVersion: (current.aggregateVersion || 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      subscriptions.set(subscriptionId, updated);
      return updated;
    },

    async recordSubscriptionEvent(event) {
      const key = webhookEventKey(event);
      if (subscriptionEvents.has(key)) {
        return { inserted: false, duplicate: true };
      }

      subscriptionEvents.add(key);
      return { inserted: true, duplicate: false };
    },

    async createInvoice(entry) {
      const normalized = { ...normalizeInvoiceEntry(entry), aggregateVersion: entry.aggregateVersion || 1 };
      invoices.set(normalized.invoiceId, normalized);
      return normalized;
    },

    async getInvoice(invoiceId, tribeId) {
      return tenantScoped(invoices.get(invoiceId), tribeId);
    },

    async listInvoicesForSubscription(subscriptionId, tribeId) {
      return Array.from(invoices.values()).filter(
        (invoice) => invoice.subscriptionId === subscriptionId && invoice.tribeId === tribeId,
      );
    },
  };
}

module.exports = { createMemoryPaymentStore };


