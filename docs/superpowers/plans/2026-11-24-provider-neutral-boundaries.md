---
title: Provider-neutral boundaries implementation plan
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: [contracts/public/apicenter.openapi.yaml, contracts/public/apicenter.asyncapi.yaml, scripts/contracts/validate-public-contracts.ts, apps/payments/src/shared/payment-ids.ts, apps/payments/src/shared/paymongo-client.ts, apps/payments/src/server.ts, packages/runtime/src/delivery.js, apps/email/src/features/send-email/send-email.service.ts, apps/sms/src/shared/postgres-sms-store.ts, apps/otp/src/features/generate-otp/generate-otp.service.ts, apps/geo/src/shared/google-maps-provider.ts, apps/gateway/src/domains/gateway-proxy/shared-services/delivery-webhook.controller.ts]
---
# Provider-Neutral Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sure a vendor change never forces a product that uses APICenter to change. Products must not see a vendor's names, IDs, errors or raw data. Inside APICenter, SMS, email and geocoding each sit behind one interface. We keep one vendor per capability; this plan makes switching possible, not routine.

**Architecture:** Outside in.
1. A recorded decision and an automated contract guardrail stop new leaks.
2. APICenter mints its own public IDs for payments and SMS, and stores the provider's IDs as data.
3. Provider errors and geocoding results are translated into APICenter's own shapes.
4. SMS, email and geocoding go through interfaces in code, each with one conformance suite that every adapter passes.
5. Customer-visible changes are additive first, deprecated for 90 days, and removed only in a contract major version.

**Tech Stack:** TypeScript on Node 24, Express 5 runtimes, the NestJS gateway, `pg`, zod, Jest 30, OpenAPI 3.2 and AsyncAPI 3.1, and Supabase Postgres migrations.

**Spec:** This plan's Decisions section and ADR-0010 (Task 1). The lock-in audit of 2026-11-24 is summarized under Current lock-in.

**Contract edits:** every task that changes `contracts/public/*.yaml` runs `npm run contracts:sync-json && npm run contracts:validate && npm run check:contracts` before committing, and bumps `@alpha-explora/apicenter-contracts` and the SDK by a minor version for additive changes.

**Start condition:** PRs #234, #235 and #236 are merged. Rebase this branch onto `main` before Task 1; Tasks 4 and 5 change the same payments files.

## Decisions

- **Provider-neutral means:**
  - The public contract, the SDK, events, error responses and public docs never name a vendor or carry a vendor's raw data.
  - APICenter mints every public ID.
  - Each external capability is called through one interface.
  - It does not mean running several vendors at once.
- **Deprecation policy:** mark the item `deprecated: true` in the contract and SDK, send `Deprecation` and `Sunset` response headers, and record it in `CHANGELOG.md`. Remove it no earlier than 90 days later, and only in a contract major version.
- **In scope:** the contract guardrail, neutral errors, owned payment and SMS IDs, neutral geo results, the SMS, email and geocoding interfaces, webhooks as the default event delivery, a neutral payout wallet destination, and payments guidance.
- **Only when a trigger occurs:**
  - a second payments or geocoding adapter
  - generic OIDC login in place of Google-only login
  - more workload identity issuers
  - leaving GCP (Secret Manager, internal Pub/Sub, Scheduler, Cloud Run service auth)
  - the console's Google sign-in

  Triggers: a vendor refuses a feature we need, freezes the account, raises prices materially, or a product asks for a capability the vendor lacks.
- **Second SMS provider:** the interface and conformance suite ship now. The adapter (Task 10) starts once a Philippine SMS vendor is chosen, because each project's sender name must be registered with that vendor first.

## Current lock-in (audit, 2026-11-24)

| Area | Leak |
|---|---|
| Payments contract | `ConfirmPaymentIntentRequest` needs a `paymentMethodId` from the provider's client-side flow and a `clientKey`. Five descriptions name PayMongo. |
| Payment IDs | Public IDs are the provider's IDs with a swapped prefix (`payment-ids.ts`, 63 calls in 9 files). `pay_` IDs are the provider's own. Webhooks find records by deriving the ID. |
| Payment errors | `paymongo-client.ts` throws the provider's error code, message and whole response body, and `handleCustomError` (`server.ts:205`) returns all three. |
| SMS | The public `messageId` is the provider's message ID, and status callbacks match on it. |
| Email | IDs are APICenter's. The Resend SDK is called directly, and responses carry `provider: "resend"`. |
| OTP | Calls `sendTwilioSms` and `sendResendEmail` directly, bypassing the SMS and email services. |
| Geo | `GeoAddressResult` exposes `placeId`, `types`, `provider: google-maps` and `raw` (the whole provider result). |
| Payouts | The `provider_wallet` destination means one vendor's wallet. |
| Events | Destinations support signed webhooks (`webhook`) and Google Pub/Sub push (`pubsub-push`). The AsyncAPI document lists only Pub/Sub servers. |
| Public docs | 14 pages name PayMongo 26 times, plus Resend, Google Maps and Pub/Sub. |

**Lock-in no code removes**, recorded so nobody assumes an adapter means an instant switch:
- Saved cards and subscriptions: card tokens stay with the payment provider, so moving recurring billing means customers enter cards again.
- Merchant onboarding with a new payment provider takes weeks, including child accounts and payee wallets.
- SMS sender names are registered per SMS vendor in the Philippines.
- Email sender domains are verified per email vendor (SPF and DKIM).
- Cached Google geocoding results cannot be reused with another provider.

## Review Focus

1. **An existing ID stops working.** Every payment and SMS ID issued before this plan must keep working for reads, refunds, cancels and status callbacks, forever. Pinned in Task 5 (`a pre-migration checkout ID still reads, cancels and refunds`) and Task 6 (`a provider-issued SMS ID still reads its status`).
2. **A webhook for an old resource finds nothing.** Provider webhooks resolve records through the backfilled provider ID. Pinned in Task 5 (`a webhook for a pre-migration payment link marks it paid`).
3. **Neutral errors hide what a product needs.** A declined card still tells the product it was declined, with a neutral reason. Pinned in Task 4 (`a provider decline becomes PAYMENT_DECLINED with a neutral reason`).
4. **OTP delivery changes behavior when it moves behind the interface.** OTP's provider timeouts, circuit breaker and suppressed test recipients are unchanged. Pinned in Task 8 (`otp sends through the sms and email senders with the same guards`).
5. **A deprecated field disappears early.** Deprecated fields stay populated until their sunset date. Pinned in Task 3 (`deprecated fields must declare a sunset`) and Task 7 (`still returns placeId, types and raw while deprecated`).

---

### Task 1: ADR-0010 and the deprecation policy

**Files:**
- Create: `docs/adr/0010-provider-neutral-boundaries.md`
- Modify: `docs/adr/index.md`, `apps/docs/content/docs/` (a "Versioning and deprecation" page), `CONTRIBUTING.md` (a provider-neutral rule for new integrations)

- [ ] **Step 1: Write ADR-0010** with the Decisions section above, the triggers, and the "lock-in no code removes" list. Status: accepted.
- [ ] **Step 2: Write the public "Versioning and deprecation" page:** IDs are opaque strings; deprecated items carry `Deprecation` and `Sunset` headers; removal waits 90 days and a contract major version.
- [ ] **Step 3: Run** `npm run check:documentation && npm run test:documentation`. Expected: PASS.
- [ ] **Step 4: Commit:** `git commit -m "docs(adr): record provider-neutral boundaries and deprecation policy"`

### Task 2: Usage inventory (read-only)

**Files:**
- Create: `scripts/report-provider-coupled-usage.ts`
- Modify: this plan (a Usage section with the results)

**Interfaces:**
- Produces: `npx ts-node scripts/report-provider-coupled-usage.ts --database-url <url> --days 90`, which prints per environment and project:
  - intents confirmed through `/intents/{id}/confirm` (`resource_owners`, `resource_type = 'intent'`, status beyond `awaiting_payment_method`)
  - event destinations by `transport` (`apic_catalog.cp_event_destinations`)
  - SMS messages sent
  - geo requests (`apic_runtime.usage_rollups`, geo route family)
  - payees with a `provider_wallet` destination

- [ ] **Step 1: Write the script.** It runs `SELECT` statements only, inside a `READ ONLY` transaction.
- [ ] **Step 2: Run it** against the local replayed database. Expected: zero counts, no errors.
- [ ] **Step 3: Ask the user** before running it against test and live with each environment's read-only credentials. Record the results in this plan's Usage section. They set who must be told about each deprecation.
- [ ] **Step 4: Commit:** `git commit -m "chore: report usage of provider-coupled API features"`

### Task 3: Contract and docs guardrail

**Files:**
- Modify: `scripts/contracts/validate-public-contracts.ts`, `scripts/check-documentation.mjs`, `contracts/public/apicenter.openapi.yaml`, `contracts/public/apicenter.asyncapi.yaml`, the 14 public docs pages that name vendors
- Create: `contracts/public/provider-terms.json`
- Test: `tests/unit/contracts/provider-terms.spec.ts`

**Interfaces:**
- `provider-terms.json`:
  ```json
  { "forbidden": ["paymongo", "twilio", "resend", "google maps", "maps.googleapis", "pubsub.googleapis"],
    "allowed": [{ "term": "google", "where": ["gauth paths", "auth:google:login", "Google*Request", "Google*Response"] },
                { "term": "pubsub", "where": ["pubsub-push transport"] }],
    "deprecatedFields": [{ "schema": "GeoAddressResult", "field": "raw", "sunset": "2027-03-01" }] }
  ```
- Payment-method values (`gcash`, `paymaya`, `qrph`, `card`) and the `instapay` rail are not vendors and are not listed.
- The validator fails on:
  - a forbidden term in any path, schema name, property name, enum value, description or example
  - a property named `raw` or `placeId` that is not listed in `deprecatedFields`
  - a `deprecated: true` field without a `sunset` entry
- The docs check fails on a forbidden term in `apps/docs/content`, except on one page, `providers-and-data.mdx`. That page lists the sub-processors, as the Data Privacy Act requires.

- [ ] **Step 1: Write the failing tests:** each forbidden term in a description fails; `gcash` passes; `raw` without a deprecation entry fails; `deprecated fields must declare a sunset`.
- [ ] **Step 2: Run** `npx jest tests/unit/contracts/provider-terms.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the checks, then clean the current text.** Remove the five PayMongo mentions, the Resend and Google Maps mentions, and the docs-page mentions. Rewrite them neutrally ("the payment provider", "the wallet"), moving sub-processor names to `providers-and-data.mdx`. The AsyncAPI Pub/Sub servers stay, under the allowed `pubsub-push` entry, until Task 9.
- [ ] **Step 4: Run** `npm run contracts:sync-json && npm run contracts:validate && npm run check:contracts && npm run check:documentation && npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "chore(contracts): forbid provider names and raw provider data in public contracts"`

### Task 4: Neutral payment errors

**Files:**
- Create: `apps/payments/src/shared/provider-errors.ts`
- Modify: `apps/payments/src/shared/paymongo-client.ts`, `apps/payments/src/server.ts:205-217`, the OpenAPI error schema, `CHANGELOG.md`
- Test: `tests/unit/src/payments/provider-errors.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NeutralPaymentErrorCode = 'PAYMENT_DECLINED' | 'PAYMENT_REQUEST_INVALID' | 'NOT_FOUND'
    | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_ERROR';
  export type DeclineReason = 'insufficient_funds' | 'card_expired' | 'card_declined' | 'authentication_failed'
    | 'processor_unavailable' | 'other';
  export function toNeutralError(status: number, providerCode: string | undefined):
    { status: number; code: NeutralPaymentErrorCode; message: string; reason?: DeclineReason };
  ```
- Mapping:
  - 400 and 422 → `PAYMENT_REQUEST_INVALID` (400), or `PAYMENT_DECLINED` (402) for decline codes, with a `reason`
  - 404 → `NOT_FOUND` (404)
  - 429 → `PROVIDER_RATE_LIMITED` (429)
  - 401 and 403 → `PROVIDER_UNAVAILABLE` (503), since those mean our credentials, not the caller's request
  - 5xx and unreachable → `PROVIDER_ERROR` (502)
- APICenter's own codes (`IDEMPOTENCY_KEY_REQUIRED`, `LINKED_ACCOUNTS_DISABLED` and the rest) are unchanged.
- The provider's code, message and body are logged server-side with the request ID, never returned.
- **Compatibility for 90 days:** the response also carries `details.deprecatedProviderCode`, the provider's code only, and the deprecation headers. It is listed in `provider-terms.json` with its sunset.

- [ ] **Step 1: Write the failing tests:** `a provider decline becomes PAYMENT_DECLINED with a neutral reason`; a provider 401 becomes 503 `PROVIDER_UNAVAILABLE`; the response body contains neither the provider's message nor its body; `details.deprecatedProviderCode` is present, along with the `Sunset` header.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/provider-errors.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The client builds the neutral error. `handleCustomError` returns only neutral fields.
- [ ] **Step 4: Run** `npx jest tests/unit/src/payments` and the gateway payments specs. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(payments): return provider-neutral payment errors"`

### Task 5: APICenter-owned payment IDs

Staged in three commits, each green.

**Files:**
- Create: `supabase/migrations/<timestamp>_owned_payment_ids.sql`, `apps/payments/src/shared/payment-id-map.ts`
- Modify: the nine files that call `toPublicId` / `toProviderId` (`checkout`, `customers-catalog`, `invoices`, `payment-intents`, `payment-links`, `refunds`, `subscriptions`, `webhooks`, `events/pubsubPublisher.js`), `shared/payment-owner-store.ts`; delete `shared/payment-ids.ts` at the end
- Test: `tests/unit/src/payments/payment-id-map.spec.ts`, `tests/integration/owned-payment-ids.integration.spec.ts`

**Migration:**
- `shared_payment.resource_owners`: add `provider text NOT NULL DEFAULT 'paymongo'` and `provider_resource_id text`.
- Backfill `provider_resource_id` from `resource_id` with the current prefix map (`chk_`→`cs_`, `pl_`→`link_`, `inv_`→`in_`, the others unchanged).
- Add a unique index on `(environment, provider, resource_type, provider_resource_id)` where it is not null.

**Interfaces:**
- Produces:
  ```ts
  export function mintPublicId(prefix: 'chk' | 'pi' | 'pay' | 'ref' | 'pl' | 'cus' | 'sub' | 'inv' | 'plan'): string;
  // `${prefix}_` + 26 lowercase Crockford base32 characters; a primary-key conflict re-mints
  export interface PaymentIdMap {
    providerId(environment: Environment, resourceType: string, publicId: string): Promise<string>; // 404 NOT_FOUND
    publicId(environment: Environment, provider: string, resourceType: string, providerId: string): Promise<string | null>;
  }
  ```
- New resources get a minted public ID, and the provider ID is stored in the same insert. Existing rows keep their IDs.

- [ ] **Step 1 (5a): Write the failing tests:** `mintPublicId` has the format; the map resolves both ways; `a pre-migration checkout ID still reads, cancels and refunds`. Run them: FAIL. Write the migration, `payment-id-map.ts`, and the owner-store columns. Run: PASS. Commit: `feat(payments): store provider IDs beside APICenter payment IDs`.
- [ ] **Step 2 (5b): Checkout, intents, payment links, refunds and payments.** Creates mint IDs. Reads, actions and webhooks use `PaymentIdMap`. Test: `a webhook for a pre-migration payment link marks it paid`; a new checkout's public ID differs from its provider ID; a refund of a minted `pay_` ID reaches the provider with the provider's payment ID. Run `npx jest tests/unit/src/payments` and the integration spec: PASS. Commit: `feat(payments): mint IDs for collections and refunds`.
- [ ] **Step 3 (5c): Customers, plans, subscriptions, invoices and published events.** Same pattern. Then delete `payment-ids.ts`; `git grep -nE "toPublicId|toProviderId"` must return nothing. Run the full suite and `npm run test:integration` against a replayed database: PASS. Commit: `feat(payments): mint IDs for billing resources and events`.

### Task 6: APICenter-owned SMS IDs

**Files:**
- Create: `supabase/migrations/<timestamp>_owned_sms_ids.sql`
- Modify: `apps/sms/src/shared/postgres-sms-store.ts`, `apps/sms/src/shared/sms-store.ts`, `apps/sms/src/features/send-sms/send-sms.service.ts`, the SMS delivery-status update path behind `delivery-webhook.controller.ts`
- Test: `tests/unit/src/sms/sms-ids.spec.ts`

**Interfaces:**
- The messages table gains `provider text NOT NULL DEFAULT 'twilio'` and `provider_message_id text`, backfilled from `message_id`, with a unique index on `(provider, provider_message_id)`.
- New messages get `messageId = 'sms_' + 26 Crockford base32 characters`. Status callbacks look up by `provider_message_id`.

- [ ] **Step 1: Write the failing tests:** a new send returns an `sms_` ID; `a provider-issued SMS ID still reads its status`; a delivery callback for a new message updates it through `provider_message_id`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/sms`. Expected: FAIL.
- [ ] **Step 3: Implement,** following email, which already mints its own IDs (`postgres-email-store.ts`).
- [ ] **Step 4: Run** the SMS and gateway delivery-webhook specs. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(sms): mint APICenter message IDs`

### Task 7: Neutral geocoding results and the geocoding interface

**Files:**
- Create: `apps/geo/src/shared/geocoding-provider.ts`, `apps/geo/src/shared/google-geocoding-adapter.ts` (moved from `google-maps-provider.ts`)
- Modify: `apps/geo/src/features/geocode/geocode.service.ts`, `reverse-geocode/reverse-geocode.service.ts`, `GeoAddressResult` in the OpenAPI document and `packages/contracts/src/index.ts`, `provider-terms.json`
- Test: `tests/unit/src/geo/geocoding-conformance.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AddressComponents = { streetNumber?: string; street?: string; barangay?: string; city?: string;
    province?: string; region?: string; postalCode?: string; country: string };
  export type GeocodingResult = { formattedAddress: string; latitude: number; longitude: number;
    components: AddressComponents; precision: 'exact' | 'street' | 'area' | 'approximate' };
  export interface GeocodingProvider {
    geocode(input: { address: string; language?: string; region?: string }): Promise<GeocodingResult>;
    reverse(input: { latitude: number; longitude: number; language?: string }): Promise<GeocodingResult>;
  }
  export function createGeocodingProvider(): GeocodingProvider; // GEOCODING_PROVIDER=google|mock
  ```
- The public `GeoAddressResult` gains `components` and `precision`.
- `placeId`, `types`, `provider` and `raw` become `deprecated: true` with a sunset 90 days after release, and stay populated until then. The adapter keeps the provider's raw result only for that window.

- [ ] **Step 1: Write the failing conformance suite:** each adapter (Google with recorded fixture responses, and the mock) returns a valid `GeocodingResult`; Philippine components map (`barangay` from `sublocality_level_1` or `administrative_area_level_5`); `still returns placeId, types and raw while deprecated`; the services import no adapter directly.
- [ ] **Step 2: Run** `npx jest tests/unit/src/geo`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the cache, circuit breaker and metrics in the service, around the interface.
- [ ] **Step 4: Run** the geo, contract and SDK specs. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(geo): return provider-neutral geocoding results`

### Task 8: SMS and email senders

**Files:**
- Create: `packages/runtime/src/messaging.js` (with types in `index.d.ts`), `packages/runtime/src/adapters/twilio-sms.js`, `adapters/resend-email.js`, `adapters/mock-messaging.js`
- Modify: `packages/runtime/src/delivery.js` (remove `sendTwilioSms` and `sendResendEmail` once nothing calls them), `apps/sms/src/shared/twilio-sms-provider.ts` (delete), `apps/sms/src/features/send-sms/send-sms.service.ts`, `apps/email/src/features/send-email/send-email.service.ts` (drop the `resend` dependency), `apps/otp/src/features/generate-otp/generate-otp.service.ts`, `apps/otp/src/server.ts:99-101`, the gateway delivery-webhook controller (one status normalizer per provider)
- Test: `tests/unit/src/runtime/messaging-conformance.spec.ts`, and the existing SMS, email and OTP specs

**Interfaces:**
- Produces:
  ```ts
  export type SmsSendResult = { providerMessageId: string; status: 'queued' | 'sent' | 'delivered' | 'failed' };
  export interface SmsSender { readonly provider: string; configured(): boolean;
    send(input: { to: string; message: string; senderId?: string; statusCallback?: string }): Promise<SmsSendResult> }
  export interface EmailSender { readonly provider: string; configured(): boolean;
    send(input: { to: string[]; from: string; subject: string; text?: string; html?: string; replyTo?: string }):
      Promise<{ providerMessageId: string }> }
  export function createSmsSender(env?: NodeJS.ProcessEnv): SmsSender;     // SMS_PROVIDER=twilio|mock
  export function createEmailSender(env?: NodeJS.ProcessEnv): EmailSender; // EMAIL_PROVIDER=resend|mock
  export interface DeliveryStatusNormalizer { provider: string; verify(req: RawRequest): boolean;
    parse(req: RawRequest): { providerEventId: string; providerMessageId: string; status: string } | null }
  ```
- Each provider's timeouts, circuit breaker and metrics wrap the interface, not the adapter.
- The public email response's `provider` field becomes `deprecated: true`, with a 90-day sunset.

- [ ] **Step 1: Write the failing conformance suite:** every sender passes the same cases (success, provider 4xx, 5xx, timeout, and missing configuration giving `configured() === false`); `otp sends through the sms and email senders with the same guards`; no file outside `packages/runtime/src/adapters` names a vendor SDK or URL (checked with `git grep`).
- [ ] **Step 2: Run** `npx jest tests/unit/src/runtime/messaging-conformance.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** moving the existing Twilio and Resend code into the adapters unchanged in behavior.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `refactor(messaging): send SMS and email through provider interfaces`

### Task 9: Events, payouts and payments guidance

**Files:**
- Modify: `contracts/public/apicenter.asyncapi.yaml`, `contracts/public/apicenter.openapi.yaml` (payout destination), the payouts store and routes (destination parsing), the console event-destination form, the events, payouts and payments docs pages, `CHANGELOG.md`
- Test: the payouts routes, contracts and console event-destination specs, extended

**Changes:**
- **Events:**
  - The AsyncAPI document describes signed webhook delivery (Standard Webhooks) as the primary channel, and keeps Pub/Sub push as an optional binding.
  - The console's new-destination form defaults to `webhook`, and labels `pubsub-push` "Google Cloud Pub/Sub push (requires Google Cloud)".
  - Nothing is removed.
- **Payouts:**
  - A new destination type `{ type: 'wallet', bic, accountNumber, accountName }` is accepted.
  - `provider_wallet` becomes `deprecated: true` with a 90-day sunset, and is stored as the new type.
  - Payee wallet onboarding (Phase B) writes the new type.
- **Payments guidance:**
  - The payments guide recommends hosted checkout, payment links and QR Ph as the provider-neutral flows.
  - The intent confirm operation is described as "requires the payment provider's client-side step"; it is not deprecated.

- [ ] **Step 1: Write the failing tests:** a `wallet` destination round-trips and pays through the `paymongo` rail; `provider_wallet` is still accepted, and returned with the deprecation headers; the console form defaults to `webhook`.
- [ ] **Step 2: Run** the specs. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, the contract validation and `npm run check:documentation`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: default to signed webhooks and accept neutral wallet destinations`

### Task 10 (held): A second SMS adapter

Starts when the user chooses a Philippine SMS vendor and its sender-name registration is under way.

**Files:**
- Create: `packages/runtime/src/adapters/<vendor>-sms.js`, its status normalizer
- Test: added to `messaging-conformance.spec.ts`

- [ ] **Step 1: Add the vendor to the conformance suite**, with recorded fixtures. Run it: FAIL.
- [ ] **Step 2: Implement the adapter and normalizer.** Run: PASS.
- [ ] **Step 3: Document the switch in the runbook:** register sender names, set `SMS_PROVIDER`, and watch delivery rates for a day before turning the old one off.
- [ ] **Step 4: Commit:** `feat(sms): add <vendor> SMS adapter`

## After this plan

1. Announce every deprecation (geo `placeId`, `types`, `raw` and `provider`; the email `provider` field; `details.deprecatedProviderCode`; `provider_wallet`) to the projects Task 2 found using them, with the sunset dates.
2. On each sunset date, remove the item in the next contract major version, and drop its entry from `provider-terms.json`.
3. Revisit the "only when a trigger occurs" list whenever a trigger happens.
