# Payment Platform Cutover Checklist

Record the operator, commit SHA, environment, timestamps, and links to logs for
every checked item.

## Contract And Build Gates

- [ ] `npm run contracts:validate`
- [ ] `npm run contracts:test`
- [ ] `npm run check:contracts`
- [ ] `npm run typecheck`
- [ ] `npm run test:integration`
- [ ] SDK build and package verification pass
- [ ] AlphaCI focused tests and typecheck pass

## Credentials And Ownership

- [ ] Consumer API key is scoped to the correct tribe, service, environment,
  and payment scopes
- [ ] PayMongo credentials exist only in the private payments runtime
- [ ] AlphaCI active PayMongo secret loading is disabled
- [ ] AlphaCI direct PayMongo webhook route is absent from the deployed revision
- [ ] Key rotation overlap and old-key revocation are recorded

## Pub/Sub And IAM

- [ ] Environment topic exists
- [ ] Consumer subscription filter matches the consumer service ID
- [ ] OIDC push token audience matches the AlphaCI event endpoint
- [ ] Delivery service account has Cloud Run invoker access
- [ ] Payments service account has topic publisher access
- [ ] Dead-letter topic and subscription exist
- [ ] Maximum delivery attempts is 20
- [ ] Monitoring alert is active

## Data And Smoke Evidence

- [ ] Active-record import completed with zero failed records
- [ ] Reconciliation completed with zero unmatched non-terminal records
- [ ] No unprocessed AlphaCI inbox events
- [ ] No dead-letter messages during the observation window
- [ ] Checkout smoke replay returned the same resource
- [ ] Checkout status was retrieved through the SDK
- [ ] Verified sandbox `payment.checkout.paid` event was delivered once
- [ ] AlphaCI projection reached the expected aggregate version
- [ ] Entitlement became active
- [ ] Stale duplicate did not change projection or entitlement
- [ ] Canonical event contains no provider payload or secret field
- [ ] Refund and subscription smoke checks passed

## Gate And Rollback

- [ ] Gate was false during import and preflight
- [ ] Approved cohort and observation window are recorded
- [ ] `APICENTER_PAYMENTS_ENABLED=true` was enabled only after evidence approval
- [ ] Rollback was tested by disabling the gate
- [ ] Rollback does not replay or recreate provider commands
- [ ] Expansion approval is recorded
