# APICenter Payment Platform Context

APICenter provides reusable payment capabilities to product backends while keeping payment-provider ownership and settlement inside the platform.

## Language

**Merchant of Record**:
APICenter is the legal and operational PayMongo merchant for v1 payment processing, including merchant configuration and settlement responsibility.
_Avoid_: Consumer merchant, tenant merchant

**Consumer Service**:
A registered product backend that calls APICenter and receives payment lifecycle events for one owner tribe and environment.
_Avoid_: Project, client app, webhook

**Owner Tribe**:
The APICenter tenancy and authorization boundary that owns a consumer service and its payment resources.
_Avoid_: Project

**Payment Resource**:
A provider-neutral APICenter record for a checkout, payment intent, refund, subscription, invoice, customer, or payment-method setup.
_Avoid_: PayMongo object

**Payment Intent**:
An APICenter payment resource that tracks a payment attempt from creation through confirmation, failure, cancellation, or expiry without exposing provider-specific fields.
_Avoid_: PayMongo PaymentIntent object

**Payment Projection**:
A consumer service's local, idempotent representation of an APICenter payment resource used for its own billing and entitlement decisions.
_Avoid_: Dual write

**Reference ID**:
The stable consumer-defined identifier that links an APICenter payment resource to its local record.
It is unique within `(ownerTribeId, consumerServiceId, environment)`.
_Avoid_: Provider reference

**First-Party Consumer**:
A product backend owned by AlphaExplora that uses APICenter to collect revenue belonging to APICenter.
_Avoid_: Marketplace seller, third-party merchant

**Settlement**:
The allocation or payout of collected funds to an independent third party; it is outside the v1 payment platform.
_Avoid_: Consumer billing projection

**Consumer-Scoped Customer**:
A merchant customer record that belongs to exactly one consumer service, even when the same person uses multiple first-party products.
_Avoid_: Shared customer, global customer

**Reusable Payment Method**:
A saved payment-method reference usable only by its consumer-scoped customer and the consumer service that created it.
_Avoid_: Shared vault, platform-wide payment method

**Refund Request**:
An idempotent command from the original consumer service to refund all or part of its own payment, limited by the remaining refundable amount.
_Avoid_: Manual-only refund, cross-consumer refund

**Operable Payment Resource**:
A payment resource with at least one remaining provider operation, including a paid payment still within its provider refund window.
_Avoid_: Completed payment, terminal payment

**Payment Currency**:
The currency of a v1 APICenter payment resource; it is always PHP.
_Avoid_: Multi-currency payment, foreign-currency amount

**Charge Amount**:
The final gross PHP amount supplied by a consumer service for an APICenter payment resource, optionally accompanied by a declared tax breakdown.
_Avoid_: APICenter-calculated price, tax engine

**Payment Invoice**:
A provider/payment billing artifact associated with a payment or subscription; it is not a BIR-compliant fiscal invoice or official receipt.
_Avoid_: Tax invoice, official receipt

**Payment Event Archive**:
APICenter's 90-day retained record of normalized payment events used for controlled consumer replay; it is distinct from short-term Pub/Sub delivery retention.
_Avoid_: Pub/Sub history

**API Key Rotation**:
The replacement of a consumer-service credential with a 24-hour overlap for safe deployment, or immediate revocation when compromise is suspected.
_Avoid_: Permanent dual keys

**Payment Quota**:
The per-consumer-service API limit applied before a provider call: 20 payment mutations and 100 payment reads per minute in v1.
_Avoid_: Global-only rate limit

**Payment Amount Limit**:
A per-consumer-service maximum for one payment mutation, defaulting to PHP 100,000 and configurable only through APICenter management.
_Avoid_: Unbounded payment amount

**Payment Reconciliation**:
The scheduled comparison of operable local projections with APICenter resources every 15 minutes, plus a daily audit sweep for active subscriptions and recently terminal resources.
_Avoid_: Provider mutation retry

**Quarantined Provider Event**:
A verified provider webhook that cannot be attributed to one owner tribe, consumer service, and reference ID; it is retained for operations and never published to a consumer.
_Avoid_: Guessed tenant event

**Quarantine Re-match Window**:
The 24-hour period in which APICenter retries matching a quarantined verified provider webhook every five minutes before requiring operator resolution.
_Avoid_: Consumer broadcast retry

**Pending Provider Outcome**:
An APICenter resource state used when a provider mutation may have succeeded but its result is not yet confirmed; it returns 202 and is resolved by idempotent retry or reconciliation.
_Avoid_: Generic provider error

**Payment Method Setup**:
A zero-charge operation that securely establishes a reusable payment-method reference for a consumer-scoped customer; success is distinct from a paid payment.
_Avoid_: Zero-value payment

**Past-Due Grace Period**:
The seven-day AlphaCI entitlement period after a subscription becomes past due; APICenter reports payment state but does not decide access.
_Avoid_: Payment-provider grace policy

**Scheduled Cancellation**:
A subscription cancellation that stops future renewal while retaining access through the already-paid current period.
_Avoid_: Immediate cancellation

**Immediate Cancellation**:
A privileged subscription operation that ends access and future billing now, requiring the `payments:subscriptions:cancel-immediately` scope.
_Avoid_: Normal customer cancellation

**Scheduled Plan Change**:
A subscription upgrade or downgrade that takes effect at the next billing-period boundary without automatic proration or immediate credit.
_Avoid_: Immediate proration

**Renewal Retry Schedule**:
APICenter's provider renewal execution and retry policy; AlphaCI does not issue provider renewal retries and owns only its seven-day entitlement grace period.
_Avoid_: Product-owned provider retry

**APICenter GCP Project**:
The dedicated Google Cloud project that owns APICenter gateway infrastructure, Pub/Sub, service accounts, secrets, monitoring, and billing; AlphaCI projects consume it.
_Avoid_: AlphaCI project

**Developer Documentation Host**:
The stable public hostname for the static APICenter API and event reference, separate from the gateway runtime and Management application.
_Avoid_: Swagger runtime URL

**Cohort Rollback Trigger**:
Any projection lag over 15 minutes, unexplained non-terminal state mismatch,
payment-event dead-letter message, or failed checkout, renewal, or refund smoke
test that pauses rollout expansion and disables the APICenter feature gate for
the affected cohort; rollback never restores a second direct PayMongo command
path.
_Avoid_: Direct-provider fallback

**Payment Data Plane**:
The private `api-center/apps/payments` runtime that owns PayMongo credentials and calls, webhook verification, canonical payment state, provider renewal execution, and the transactional outbox.
_Avoid_: Consumer-facing gateway responsibility

**Payment Control Plane**:
The public `api-center` gateway and management boundary that owns consumer identity, tenant authorization, quotas, idempotency policy, public routes, audit, Pub/Sub infrastructure, delivery provisioning, and replay; it never calls PayMongo directly.
_Avoid_: Provider adapter responsibility

**APICenter Monorepo**:
The Turborepo and npm-workspaces source of truth for the gateway, payment runtime, shared runtimes, SDK, contracts, and Management app; each app remains independently deployable.
_Avoid_: One-process platform

**Legacy api-shared Repository**:
The frozen migration source for runtimes and packages moving into APICenter; it receives no new payment features and is archived only after parity and deployment evidence.
_Avoid_: Second payment source of truth

