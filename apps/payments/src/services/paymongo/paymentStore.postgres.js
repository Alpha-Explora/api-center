const {
  assertCanonicalStatus,
  assertCanonicalSubscriptionStatus,
  normalizeCheckoutEntry,
  normalizeCustomerEntry,
  normalizeInvoiceEntry,
  normalizePriceEntry,
  normalizeProductEntry,
  normalizeSubscriptionEntry,
  resolvePaymentEnvironment,
  rowToCheckout,
  rowToCustomer,
  rowToInvoice,
  rowToPayment,
  rowToPrice,
  rowToProduct,
  rowToSubscription,
} = require('./paymentStore.common');

function createPostgresPaymentStore(databaseUrl) {
  let sqlPromise;

  async function getSql() {
    if (!sqlPromise) {
      sqlPromise = Promise.resolve()
        .then(() => require('postgres'))
        .then((postgres) => postgres(databaseUrl, { max: 3 }));
    }

    return sqlPromise;
  }

  function runtimeEnvironment(input = {}) {
    return resolvePaymentEnvironment({
      providerMode: process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test',
      ...input,
    });
  }

  return {
    enabled: true,

    async withTransaction(work) {
      const sql = await getSql();
      return sql.begin(async (transaction) => work(transaction));
    },

    async createCheckoutSessionRecord(entry, transaction) {
      const sql = transaction || await getSql();
      const normalized = normalizeCheckoutEntry(entry);
      const rows = await sql`
        insert into shared_payment.checkout_sessions (
          tribe_id, environment, provider, provider_mode, checkout_id, reference_id,
          status, amount, currency, redirect_url, success_url, cancel_url,
          description, metadata, provider_metadata, aggregate_version, expires_at
        )
        values (
          ${normalized.tribeId}, ${normalized.environment}, ${normalized.provider},
          ${normalized.providerMode}, ${normalized.checkoutId}, ${normalized.referenceId || null},
          ${normalized.status}, ${normalized.amount?.value ?? null},
          ${normalized.amount?.currency || normalized.currency || 'PHP'},
          ${normalized.redirectUrl || null}, ${normalized.successUrl || null},
          ${normalized.cancelUrl || null}, ${normalized.description || null},
          ${sql.json(normalized.metadata || {})}, ${sql.json(normalized.providerMetadata || {})},
          ${normalized.aggregateVersion || 1}, ${normalized.expiresAt || null}
        )
        on conflict (environment, provider, checkout_id) do update set
          reference_id = excluded.reference_id,
          status = excluded.status,
          amount = excluded.amount,
          currency = excluded.currency,
          redirect_url = excluded.redirect_url,
          success_url = excluded.success_url,
          cancel_url = excluded.cancel_url,
          description = excluded.description,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          aggregate_version = shared_payment.checkout_sessions.aggregate_version + 1,
          expires_at = excluded.expires_at,
          updated_at = now()
        returning *
      `;

      return rowToCheckout(rows[0]);
    },
    async getCheckoutSessionStatus(checkoutId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.checkout_sessions
        where checkout_id = ${checkoutId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToCheckout(rows[0]) : null;
    },

    async getCheckoutSessionByReference(referenceId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.checkout_sessions
        where reference_id = ${referenceId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        order by created_at desc
        limit 1
      `;

      return rows[0] ? rowToCheckout(rows[0]) : null;
    },

    async updateCheckoutStatus(checkoutId, patch, transaction) {
      assertCanonicalStatus(patch.status);
      const sql = transaction || await getSql();
      const metadata = patch.cancellationReason
        ? { cancellationReason: patch.cancellationReason }
        : {};
      const rows = await sql`
        update shared_payment.checkout_sessions
        set
          status = ${patch.status},
          metadata = metadata || ${sql.json(metadata)},
          aggregate_version = aggregate_version + 1,
          updated_at = now()
        where checkout_id = ${checkoutId}
          and environment = ${runtimeEnvironment(patch)}
        returning *
      `;

      return rows[0] ? rowToCheckout(rows[0]) : null;
    },

    async recordWebhookEvent(event, transaction) {
      const sql = transaction || await getSql();
      const provider = event.provider || 'paymongo';
      const providerMode = event.providerMode || 'test';
      const providerEventId = event.eventId || event.providerEventId;
      const rows = await sql`
        insert into shared_payment.payment_webhook_events (
          provider, provider_mode, provider_event_id, event_type,
          status, payload_hash, metadata, processed_at
        )
        values (
          ${provider}, ${providerMode}, ${providerEventId},
          ${event.eventType || 'unknown'}, ${event.status || 'received'},
          ${event.payloadHash || null}, ${sql.json(event.metadata || {})}, null
        )
        on conflict (provider, provider_mode, provider_event_id) do nothing
        returning id, status
      `;
      if (rows.length > 0) return { inserted: true, duplicate: false, status: rows[0].status };
      const existing = await sql`
        select status
        from shared_payment.payment_webhook_events
        where provider = ${provider}
          and provider_mode = ${resolvedProviderMode}
          and provider_event_id = ${providerEventId}
        limit 1
      `;
      return { inserted: false, duplicate: true, status: existing[0]?.status };
    },

    async markWebhookEventProcessed(providerEventId, environment, transaction, providerMode) {
      const sql = transaction || await getSql();
      const resolvedProviderMode = providerMode || runtimeEnvironment({ environment });
      const rows = await sql`
        update shared_payment.payment_webhook_events
        set status = 'processed', processed_at = now()
        where provider = 'paymongo'
          and provider_mode = ${resolvedProviderMode}
          and provider_event_id = ${providerEventId}
        returning *
      `;
      return rows[0] || null;
    },
    async enqueuePaymentEvent(event, transaction) {
      const sql = transaction || await getSql();
      const payload = event.payload || {};
      const ownerTribeId = event.ownerTribeId || payload.ownerTribeId || null;
      const consumerServiceId = event.consumerServiceId || payload.consumerServiceId || null;
      const referenceId = event.referenceId || payload.referenceId || null;
      const attributed = Boolean(ownerTribeId && consumerServiceId && referenceId);
      const rows = await sql`
        insert into shared_payment.payment_event_outbox (
          environment, provider, provider_event_id, event_type, aggregate_type,
          aggregate_id, aggregate_version, owner_tribe_id, consumer_service_id,
          reference_id, payload, status, quarantine_reason, quarantine_attempts,
          quarantined_at, quarantine_expires_at
        )
        values (
          ${runtimeEnvironment(event)}, ${event.provider || 'paymongo'},
          ${event.providerEventId}, ${event.eventType || 'payment.provider_event.received'},
          ${event.aggregateType || 'payment'}, ${event.aggregateId || event.providerEventId},
          ${event.aggregateVersion || 1}, ${ownerTribeId}, ${consumerServiceId},
          ${referenceId}, ${sql.json(payload)}, ${attributed ? 'pending' : 'quarantined'},
          ${attributed ? null : 'missing_owner_tribe_id_consumer_service_id_or_reference_id'}, 0,
          ${attributed ? null : new Date()},
          ${attributed ? null : new Date(Date.now() + 24 * 60 * 60 * 1000)}
        )
        on conflict (environment, provider, provider_event_id) do nothing
        returning id
      `;
      return rows.length > 0
        ? (attributed ? { inserted: true, duplicate: false } : { inserted: true, duplicate: false, quarantined: true })
        : { inserted: false, duplicate: true };
    },

    async claimPendingPaymentEvents(limit = 50) {
      const sql = await getSql();
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe(`
          select *
          from shared_payment.payment_event_outbox
          where status in ('pending', 'retry')
            and available_at <= now()
          order by created_at
          limit $1
          for update skip locked
        `, [limit]);
        if (rows.length > 0) {
          const ids = rows.map((row) => row.id);
          await transaction`
            update shared_payment.payment_event_outbox
            set status = 'publishing', updated_at = now()
            where id = any(${sql.array(ids, "uuid")})
          `;
        }
        return rows.map((row) => ({
          ...row,
          providerEventId: row.provider_event_id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          aggregateVersion: row.aggregate_version,
          ownerTribeId: row.owner_tribe_id || row.payload?.ownerTribeId,
          consumerServiceId: row.consumer_service_id || row.payload?.consumerServiceId,
          referenceId: row.reference_id || row.payload?.referenceId,
          payload: row.payload || {},
        }));
      });
    },

    async claimQuarantinedPaymentEvents(limit = 50) {
      const sql = await getSql();
      return sql.begin(async (transaction) => {
        const rows = await transaction`
          select *
          from shared_payment.payment_event_outbox
          where status = 'quarantined'
            and available_at <= now()
            and (quarantine_expires_at is null or quarantine_expires_at > now())
          order by created_at
          limit ${limit}
          for update skip locked
        `;
        if (rows.length > 0) {
          const ids = rows.map((row) => row.id);
          await transaction`
            update shared_payment.payment_event_outbox
            set quarantine_attempts = quarantine_attempts + 1,
                available_at = now() + interval '5 minutes',
                updated_at = now()
            where id = any(${sql.array(ids, 'uuid')})
          `;
        }
        return rows.map((row) => ({
          ...row,
          providerEventId: row.provider_event_id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          aggregateVersion: row.aggregate_version,
          ownerTribeId: row.owner_tribe_id,
          consumerServiceId: row.consumer_service_id,
          referenceId: row.reference_id,
          payload: row.payload || {},
        }));
      });
    },

    async resolveQuarantinedPaymentEvent(providerEventId, attribution = {}, transaction) {
      const sql = transaction || await getSql();
      const ownerTribeId = attribution.ownerTribeId || null;
      const consumerServiceId = attribution.consumerServiceId || null;
      const referenceId = attribution.referenceId || null;
      const rows = await sql`
        update shared_payment.payment_event_outbox
        set owner_tribe_id = coalesce(${ownerTribeId}, owner_tribe_id),
            consumer_service_id = coalesce(${consumerServiceId}, consumer_service_id),
            reference_id = coalesce(${referenceId}, reference_id),
            payload = payload || ${sql.json({ ownerTribeId, consumerServiceId, referenceId })},
            status = case
              when coalesce(${ownerTribeId}, owner_tribe_id) is not null
                and coalesce(${consumerServiceId}, consumer_service_id) is not null
                and coalesce(${referenceId}, reference_id) is not null
              then 'pending' else 'quarantined' end,
            quarantine_reason = case
              when coalesce(${ownerTribeId}, owner_tribe_id) is not null
                and coalesce(${consumerServiceId}, consumer_service_id) is not null
                and coalesce(${referenceId}, reference_id) is not null
              then null else quarantine_reason end,
            available_at = now(),
            updated_at = now()
        where provider_event_id = ${providerEventId}
          and status = 'quarantined'
        returning *
      `;
      return rows[0] || null;
    },
    async markPaymentEventPublished(providerEventId, environment) {
      const sql = await getSql();
      const rows = await sql`
        update shared_payment.payment_event_outbox
        set status = 'published', published_at = now(), updated_at = now()
        where provider_event_id = ${providerEventId}
          and environment = ${runtimeEnvironment({ environment })}
        returning *
      `;
      return rows[0] || null;
    },

    async markPaymentEventFailed(providerEventId, error, environment) {
      const sql = await getSql();
      const rows = await sql`
        update shared_payment.payment_event_outbox
        set status = 'retry', attempts = attempts + 1, last_error = ${error}, updated_at = now()
        where provider_event_id = ${providerEventId}
          and environment = ${runtimeEnvironment({ environment })}
        returning *
      `;
      return rows[0] || null;
    },
    async upsertPayment(entry, transaction) {
      const sql = transaction || await getSql();
      const rows = await sql`
        insert into shared_payment.payments (
          tribe_id, environment, provider, provider_mode, payment_id, checkout_id,
          reference_id, status, amount, currency, payment_method_type,
          provider_metadata, aggregate_version
        )
        values (
          ${entry.tribeId}, ${runtimeEnvironment(entry)}, ${entry.provider || 'paymongo'},
          ${entry.providerMode || 'test'}, ${entry.paymentId}, ${entry.checkoutId || null},
          ${entry.referenceId || null}, ${entry.status || 'paid'},
          ${entry.amount?.value ?? entry.amount ?? null},
          ${entry.amount?.currency || entry.currency || 'PHP'},
          ${entry.paymentMethodType || null}, ${sql.json(entry.providerMetadata || {})},
          ${entry.aggregateVersion || 1}
        )
        on conflict (environment, provider, payment_id) do update set
          tribe_id = case when excluded.tribe_id <> 'unknown' then excluded.tribe_id else shared_payment.payments.tribe_id end,
          checkout_id = coalesce(excluded.checkout_id, shared_payment.payments.checkout_id),
          reference_id = coalesce(excluded.reference_id, shared_payment.payments.reference_id),
          status = excluded.status,
          amount = excluded.amount,
          currency = excluded.currency,
          payment_method_type = excluded.payment_method_type,
          provider_metadata = excluded.provider_metadata,
          aggregate_version = shared_payment.payments.aggregate_version + 1,
          updated_at = now()
        returning *
      `;

      return rows[0] ? rowToPayment(rows[0]) : null;
    },
    async getPaymentByProviderId(paymentId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.payments
        where payment_id = ${paymentId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToPayment(rows[0]) : null;
    },

    async upsertRefund(entry, transaction) {
      const sql = transaction || await getSql();
      const rows = await sql`
        insert into shared_payment.refunds (
          tribe_id, environment, provider, provider_mode, refund_id, payment_id,
          status, amount, currency, reason, provider_metadata, aggregate_version
        )
        values (
          ${entry.tribeId}, ${runtimeEnvironment(entry)}, ${entry.provider || 'paymongo'},
          ${entry.providerMode || 'test'}, ${entry.refundId}, ${entry.paymentId},
          ${entry.status || 'pending'}, ${entry.amount || 0}, ${entry.currency || 'PHP'},
          ${entry.reason || null}, ${sql.json(entry.providerMetadata || {})},
          ${entry.aggregateVersion || 1}
        )
        on conflict (environment, provider, refund_id) do update set
          status = excluded.status,
          amount = excluded.amount,
          currency = excluded.currency,
          reason = excluded.reason,
          provider_metadata = excluded.provider_metadata,
          aggregate_version = shared_payment.refunds.aggregate_version + 1,
          updated_at = now()
        returning *
      `;

      return rows[0] ? {
        ...rows[0],
        refundId: rows[0].refund_id,
        paymentId: rows[0].payment_id,
        tribeId: rows[0].tribe_id,
        environment: rows[0].environment,
        providerMetadata: rows[0].provider_metadata || {},
        aggregateVersion: Number(rows[0].aggregate_version || 1),
        amount: rows[0].amount === null || rows[0].amount === undefined ? undefined : { value: Number(rows[0].amount), currency: rows[0].currency || 'PHP' },
      } : null;
    },
    async createCustomer(entry) {
      const sql = await getSql();
      const normalized = normalizeCustomerEntry(entry);
      const rows = await sql`
        insert into shared_payment.customers (
          tribe_id,
          environment,
          provider,
          provider_mode,
          customer_id,
          email,
          phone,
          name,
          metadata,
          provider_metadata
        )
        values (
          ${normalized.tribeId},
          ${normalized.environment},
          ${normalized.provider},
          ${normalized.providerMode},
          ${normalized.customerId},
          ${normalized.email || null},
          ${normalized.phone || null},
          ${normalized.name || null},
          ${sql.json(normalized.metadata || {})},
          ${sql.json(normalized.providerMetadata || {})}
        )
        on conflict (environment, provider, customer_id) do update set
          email = excluded.email,
          phone = excluded.phone,
          name = excluded.name,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          updated_at = now()
        returning *
      `;

      return rowToCustomer(rows[0]);
    },

    async getCustomer(customerId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.customers
        where customer_id = ${customerId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToCustomer(rows[0]) : null;
    },

    async createProduct(entry) {
      const sql = await getSql();
      const normalized = normalizeProductEntry(entry);
      const rows = await sql`
        insert into shared_payment.products (
          tribe_id,
          environment,
          product_id,
          name,
          description,
          active,
          metadata,
          provider_metadata
        )
        values (
          ${normalized.tribeId},
          ${normalized.environment},
          ${normalized.productId},
          ${normalized.name},
          ${normalized.description || null},
          ${normalized.active},
          ${sql.json(normalized.metadata || {})},
          ${sql.json(normalized.providerMetadata || {})}
        )
        on conflict (environment, product_id) do update set
          name = excluded.name,
          description = excluded.description,
          active = excluded.active,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          updated_at = now()
        returning *
      `;

      return rowToProduct(rows[0]);
    },

    async getProduct(productId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.products
        where product_id = ${productId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToProduct(rows[0]) : null;
    },

    async createPrice(entry) {
      const sql = await getSql();
      const normalized = normalizePriceEntry(entry);
      const rows = await sql`
        insert into shared_payment.prices (
          tribe_id,
          environment,
          price_id,
          product_id,
          amount,
          currency,
          recurring_interval,
          recurring_interval_count,
          trial_period_days,
          active,
          metadata,
          provider_metadata
        )
        values (
          ${normalized.tribeId},
          ${normalized.environment},
          ${normalized.priceId},
          ${normalized.productId},
          ${normalized.amount?.value ?? null},
          ${normalized.amount?.currency || normalized.currency || 'PHP'},
          ${normalized.recurring?.interval || null},
          ${normalized.recurring?.intervalCount || null},
          ${normalized.recurring?.trialPeriodDays || null},
          ${normalized.active},
          ${sql.json(normalized.metadata || {})},
          ${sql.json(normalized.providerMetadata || {})}
        )
        on conflict (environment, price_id) do update set
          product_id = excluded.product_id,
          amount = excluded.amount,
          currency = excluded.currency,
          recurring_interval = excluded.recurring_interval,
          recurring_interval_count = excluded.recurring_interval_count,
          trial_period_days = excluded.trial_period_days,
          active = excluded.active,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          updated_at = now()
        returning *
      `;

      return rowToPrice(rows[0]);
    },

    async getPrice(priceId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.prices
        where price_id = ${priceId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToPrice(rows[0]) : null;
    },

    async createSubscription(entry, transaction) {
      const sql = transaction || await getSql();
      const normalized = normalizeSubscriptionEntry(entry);
      const rows = await sql`
        insert into shared_payment.subscriptions (
          tribe_id, environment, provider, provider_mode, subscription_id, reference_id,
          customer_id, price_id, status, current_period_start, current_period_end,
          cancel_at_period_end, latest_invoice_id, latest_payment_id, metadata,
          provider_metadata, aggregate_version
        )
        values (
          ${normalized.tribeId}, ${normalized.environment}, ${normalized.provider},
          ${normalized.providerMode}, ${normalized.subscriptionId}, ${normalized.referenceId || null},
          ${normalized.customerId}, ${normalized.priceId}, ${normalized.status},
          ${normalized.currentPeriodStart || null}, ${normalized.currentPeriodEnd || null},
          ${Boolean(normalized.cancelAtPeriodEnd)}, ${normalized.latestInvoiceId || null},
          ${normalized.latestPaymentId || null}, ${sql.json(normalized.metadata || {})},
          ${sql.json(normalized.providerMetadata || {})}, ${normalized.aggregateVersion || 1}
        )
        on conflict (environment, provider, subscription_id) do update set
          reference_id = excluded.reference_id,
          customer_id = excluded.customer_id,
          price_id = excluded.price_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          latest_invoice_id = excluded.latest_invoice_id,
          latest_payment_id = excluded.latest_payment_id,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          aggregate_version = shared_payment.subscriptions.aggregate_version + 1,
          updated_at = now()
        returning *
      `;

      return rowToSubscription(rows[0]);
    },
    async getSubscription(subscriptionId, tribeId, environment, transaction) {
      const sql = transaction || await getSql();
      const rows = await sql`
        select *
        from shared_payment.subscriptions
        where subscription_id = ${subscriptionId}
          and (${tribeId || null}::text is null or tribe_id = ${tribeId})
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async getSubscriptionByReference(referenceId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.subscriptions
        where reference_id = ${referenceId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        order by created_at desc
        limit 1
      `;

      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async updateSubscriptionStatus(subscriptionId, patch, transaction) {
      assertCanonicalSubscriptionStatus(patch.status);
      const sql = transaction || await getSql();
      const rows = await sql`
        update shared_payment.subscriptions
        set
          status = ${patch.status},
          current_period_start = coalesce(${patch.currentPeriodStart || null}, current_period_start),
          current_period_end = coalesce(${patch.currentPeriodEnd || null}, current_period_end),
          cancel_at_period_end = coalesce(${patch.cancelAtPeriodEnd ?? null}, cancel_at_period_end),
          latest_invoice_id = coalesce(${patch.latestInvoiceId || null}, latest_invoice_id),
          latest_payment_id = coalesce(${patch.latestPaymentId || null}, latest_payment_id),
          aggregate_version = aggregate_version + 1,
          updated_at = now()
        where subscription_id = ${subscriptionId}
          and environment = ${runtimeEnvironment(patch)}
        returning *
      `;

      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async recordSubscriptionEvent(event, transaction) {
      const sql = transaction || await getSql();
      const rows = await sql`
        insert into shared_payment.subscription_events (
          environment,
          provider,
          provider_mode,
          provider_event_id,
          subscription_id,
          event_type,
          status,
          metadata,
          processed_at
        )
        values (
          ${runtimeEnvironment(event)},
          ${event.provider || 'paymongo'},
          ${event.providerMode || 'test'},
          ${event.providerEventId || event.eventId},
          ${event.subscriptionId || null},
          ${event.eventType || 'unknown'},
          ${event.status || 'received'},
          ${sql.json(event.metadata || {})},
          now()
        )
        on conflict (environment, provider, provider_event_id) do nothing
        returning id
      `;

      return rows.length > 0
        ? { inserted: true, duplicate: false }
        : { inserted: false, duplicate: true };
    },

    async createInvoice(entry, transaction) {
      const sql = transaction || await getSql();
      const normalized = normalizeInvoiceEntry(entry);
      const rows = await sql`
        insert into shared_payment.invoices (
          tribe_id, environment, provider, provider_mode, invoice_id, subscription_id,
          customer_id, status, amount_due, amount_paid, currency, due_at, paid_at,
          metadata, provider_metadata, aggregate_version
        )
        values (
          ${normalized.tribeId}, ${normalized.environment}, ${normalized.provider},
          ${normalized.providerMode}, ${normalized.invoiceId}, ${normalized.subscriptionId || null},
          ${normalized.customerId || null}, ${normalized.status},
          ${normalized.amountDue?.value ?? null}, ${normalized.amountPaid?.value ?? null},
          ${normalized.amountDue?.currency || normalized.amountPaid?.currency || normalized.currency || 'PHP'},
          ${normalized.dueAt || null}, ${normalized.paidAt || null},
          ${sql.json(normalized.metadata || {})}, ${sql.json(normalized.providerMetadata || {})},
          ${normalized.aggregateVersion || 1}
        )
        on conflict (environment, provider, invoice_id) do update set
          subscription_id = excluded.subscription_id,
          customer_id = excluded.customer_id,
          status = excluded.status,
          amount_due = excluded.amount_due,
          amount_paid = excluded.amount_paid,
          currency = excluded.currency,
          due_at = excluded.due_at,
          paid_at = excluded.paid_at,
          metadata = excluded.metadata,
          provider_metadata = excluded.provider_metadata,
          aggregate_version = shared_payment.invoices.aggregate_version + 1,
          updated_at = now()
        returning *
      `;

      return rowToInvoice(rows[0]);
    },
    async getInvoice(invoiceId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.invoices
        where invoice_id = ${invoiceId}
          and tribe_id = ${tribeId}
          and environment = ${runtimeEnvironment({ environment })}
        limit 1
      `;

      return rows[0] ? rowToInvoice(rows[0]) : null;
    },

    async listInvoicesForSubscription(subscriptionId, tribeId, environment) {
      const sql = await getSql();
      const rows = await sql`
        select *
        from shared_payment.invoices
        where subscription_id = ${subscriptionId}
          and (${tribeId || null}::text is null or tribe_id = ${tribeId})
          and environment = ${runtimeEnvironment({ environment })}
        order by created_at desc
      `;

      return rows.map(rowToInvoice);
    },
  };
}

module.exports = { createPostgresPaymentStore };

