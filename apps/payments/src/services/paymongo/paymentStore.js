const {
  CANONICAL_PAYMENT_STATUSES,
  CANONICAL_SUBSCRIPTION_STATUSES,
} = require('./paymentStore.common');
const { createMemoryPaymentStore } = require('./paymentStore.memory');
const { createPostgresPaymentStore } = require('./paymentStore.postgres');

let cachedStore;
let cachedSignature;

function createPaymentStore(env = process.env) {
  const enabled = env.SHARED_SERVICES_DATABASE_ENABLED === 'true';

  if (!enabled) {
    return createDisabledPaymentStore();
  }

  if (!env.SHARED_SERVICES_DATABASE_URL) {
    throw new Error('SHARED_SERVICES_DATABASE_URL is required when SHARED_SERVICES_DATABASE_ENABLED=true.');
  }

  if (env.PAYMONGO_PAYMENT_STORE_MODE === 'memory' || env.SHARED_SERVICES_DATABASE_URL.startsWith('memory://')) {
    return createMemoryPaymentStore();
  }

  return createPostgresPaymentStore(env.SHARED_SERVICES_DATABASE_URL);
}

function getPaymentStore(env = process.env) {
  const signature = [
    env.SHARED_SERVICES_DATABASE_ENABLED,
    env.SHARED_SERVICES_DATABASE_URL,
    env.PAYMONGO_PAYMENT_STORE_MODE,
  ].join('|');

  if (!cachedStore || cachedSignature !== signature) {
    cachedStore = createPaymentStore(env);
    cachedSignature = signature;
  }

  return cachedStore;
}

function isPaymentStoreEnabled(env = process.env) {
  return env.SHARED_SERVICES_DATABASE_ENABLED === 'true';
}

function createDisabledPaymentStore() {
  return {
    enabled: false,

    async createCheckoutSessionRecord() {
      return null;
    },

    async getCheckoutSessionStatus() {
      return null;
    },

    async getCheckoutSessionByReference() {
      return null;
    },

    async updateCheckoutStatus() {
      return null;
    },

    async getPaymentByProviderId() {
      return null;
    },

    async recordWebhookEvent() {
      return { inserted: true, duplicate: false, disabled: true };
    },

    async enqueuePaymentEvent() {
      return { inserted: true, duplicate: false, disabled: true };
    },

    async claimPendingPaymentEvents() {
      return [];
    },

    async markPaymentEventPublished() {
      return null;
    },

    async markPaymentEventFailed() {
      return null;
    },
    async upsertPayment() {
      return null;
    },

    async upsertRefund() {
      return null;
    },

    async createCustomer() {
      return null;
    },

    async getCustomer() {
      return null;
    },

    async createProduct() {
      return null;
    },

    async getProduct() {
      return null;
    },

    async createPrice() {
      return null;
    },

    async getPrice() {
      return null;
    },

    async createSubscription() {
      return null;
    },

    async getSubscription() {
      return null;
    },

    async getSubscriptionByReference() {
      return null;
    },

    async updateSubscriptionStatus() {
      return null;
    },

    async recordSubscriptionEvent() {
      return { inserted: true, duplicate: false, disabled: true };
    },

    async createInvoice() {
      return null;
    },

    async getInvoice() {
      return null;
    },

    async listInvoicesForSubscription() {
      return [];
    },
  };
}

module.exports = {
  CANONICAL_PAYMENT_STATUSES,
  CANONICAL_SUBSCRIPTION_STATUSES,
  createDisabledPaymentStore,
  createMemoryPaymentStore,
  createPaymentStore,
  createPostgresPaymentStore,
  getPaymentStore,
  isPaymentStoreEnabled,
};



