# APICenter Management Runbook

This runbook covers the active management console in `apps/management`.
The console provisions APICenter consumers, scoped API keys, service registry
records, readiness checks, and payment-event delivery settings.

## Current Runtime

- Management UI: the `apps/management` workspace.
- Gateway: APICenter Cloud Run gateway.
- Payment runtime: APICenter private payment services in `apps/payments`.
- Payment events: APICenter-owned Google Pub/Sub test/live topics.
- Consumer payments: use `@alpha-explora/apicenter-sdk`; do not distribute PayMongo credentials.

The former standalone management repository, `api-shared`, Confluent operator
workflows, and GKE deployment flow are retired migration sources.

## Local Checks

```powershell
npm install
npm run typecheck --workspace @apicenter/management
npm test --workspace @apicenter/management
npm run build --workspace @apicenter/management
```

## Consumer Provisioning

1. Register the consumer service and owning tribe.
2. Grant only the scopes required by that consumer.
3. Generate an API key and deliver it through the approved secret channel.
4. Configure the consumer with `APICENTER_URL`, `APICENTER_TRIBE_ID`,
   `APICENTER_SERVICE_ID`, and its API key.
5. For payments, configure only the SDK package and APICenter base URL.

Immediate subscription cancellation is separately scoped from cancel-at-period-end.
Rotate keys with the management action; prior keys remain valid only during the
configured overlap window.

## Payment Event Delivery

The payment runtime publishes to the test or live Pub/Sub topic. The receiving
Cloud Run service must use OIDC authentication and the configured AlphaCI service
account. Failed deliveries go to the configured dead-letter topic after the
subscription retry policy is exhausted.

Verify these settings from the deployment manifests before enabling a consumer:

- Topic and subscription names match the environment.
- Publisher and subscriber service accounts are distinct.
- The AlphaCI receiver accepts only the expected OIDC audience and subscription.
- APICenter and AlphaCI use the same contract version and consumer service ID.

## Related Current Sources

- `docs/apicenter-platform-setup.md`
- `docs/payments-platform-current.md`
- `apps/management/README.md`
- `infra/gcp/pubsub/README.md`