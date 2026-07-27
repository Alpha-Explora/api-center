# AlphaCI Payment Event Delivery

APICenter remains the payment provider boundary. AlphaCI receives only the
normalized lifecycle event and keeps a local inbox/projection for product
access, receipts, and grace-period behavior. AlphaCI does not receive or store
the PayMongo secret key.

## Delivery

1. APICenter verifies the PayMongo webhook and writes its canonical state and
   event outbox row.
2. The Pub/Sub dispatcher publishes the normalized event to the configured
   test or live topic.
3. A filtered push subscription delivers the Pub/Sub envelope to:
   `POST /integrations/apicenter/payments/events`.
4. AlphaCI validates the envelope with Zod, claims `messageId` in
   `billing.apicenter_payment_events`, and projects the event into its existing
   payment and subscription tables.
5. A duplicate `messageId` is acknowledged without applying the projection a
   second time. A failed projection returns an error so Pub/Sub can retry and
   eventually route the message to the dead-letter topic.

## Event correlation

The canonical event's `referenceId` is the merchant-owned AlphaCI payment
reference (for example `ACI-20260727-ABC123`). It is the only correlation key
AlphaCI needs to find its local `payment_attempts` row. Provider IDs such as
`checkoutId` and `paymentId` are retained as payment-provider references, not
as AlphaCI ownership identifiers.

## Authentication

Cloud Run should grant the Pub/Sub push service account `roles/run.invoker` on
the AlphaCI service and configure an OIDC token audience for the service URL.
`APICENTER_PAYMENT_EVENTS_SHARED_SECRET` is an optional local/test defense in
depth; it is not a replacement for Cloud Run OIDC verification.

## Migration order

The APICenter hosted-checkout adapter is implemented behind PAYMENT_PROVIDER=apicenter, but the direct AlphaCI PayMongo path remains the default. Keep direct mode enabled until reconciliation, payment-intent parity, and test/live smoke evidence are complete. Then enable the adapter and remove the direct PayMongo secret from AlphaCI only after the cutover checklist passes.