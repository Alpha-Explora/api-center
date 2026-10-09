-- PayMongo is the system of record for provider payment resources. APICenter keeps
-- only project ownership/reconciliation metadata, webhook receipts, and its event outbox.
-- These copied tables have no production data and are not used by the runtime.
-- Drop dependents and their referenced tables together; omit CASCADE so any unexpected
-- dependency outside this obsolete table set fails the migration visibly.
DROP TABLE IF EXISTS
  shared_payment.receipt_line_items,
  shared_payment.receipts,
  shared_payment.invoice_line_items,
  shared_payment.invoices,
  shared_payment.refunds,
  shared_payment.subscription_events,
  shared_payment.subscriptions,
  shared_payment.checkout_sessions,
  shared_payment.payments,
  shared_payment.prices,
  shared_payment.products,
  shared_payment.customers;
