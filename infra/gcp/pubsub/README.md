# APICenter Payment Pub/Sub Provisioning

These manifests describe the APICenter-owned payment event topology. The
self-service provisioning command applies the same topology idempotently after
an operator has authenticated to the dedicated APICenter GCP project.

Each environment has:

- one payment event topic with 31-day message retention;
- one dead-letter topic and subscription;
- a 20-attempt dead-letter policy;
- a dedicated Cloud Run delivery service account;
- one filtered OIDC push subscription per registered consumer service;
- a Monitoring alert for undelivered dead-letter messages.

## Dry Run

```bash
npm run gcp:provision-payment-events -- \
  --project apicenter-alpha-20260623 \
  --consumer-project alphaci-20260629 \
  --region asia-southeast1 \
  --environment test \
  --consumer-service-id alphaci-backend \
  --cloud-run-service-name alphaci-be-test \
  --endpoint https://alphaci-be-test-<hash>-as.a.run.app/payment-events \
  --delivery-service-account apicenter-payment-events-delivery@apicenter-alpha-20260623.iam.gserviceaccount.com
```

The command validates HTTPS Cloud Run endpoints, environment safety, exact
consumer filtering, OIDC configuration, 20 delivery attempts, dead-letter IAM,
Cloud Run `roles/run.invoker`, and the Monitoring policy before applying.
Without `--apply`, it prints the complete gcloud plan only.

## Apply

Authenticate first, then review the dry run and add `--apply`:

```bash
gcloud auth login
gcloud config set project apicenter-alpha-20260623
npm run gcp:provision-payment-events -- <same arguments> --apply
```

Pub/Sub resources stay in the APICenter project. The `--consumer-project` receives the Cloud Run invoker binding for the registered AlphaCI service. The Pub/Sub service agent receives publisher access on the dead-letter topic
and subscriber access on the source subscription. The delivery service account
receives `roles/run.invoker` only on the supplied consumer Cloud Run service.

## Private Payments Runtime

The private payments service is deployed from
`infra/gcp/cloud-run/apicenter-payments.test.yaml` or
`infra/gcp/cloud-run/apicenter-payments.live.yaml`. The manifests keep PayMongo
keys, webhook secrets, the database URL, and the internal gateway token in
Secret Manager references. Create these secrets before replacing the service:

- `apicenter-payments-<environment>-database-url`
- `apicenter-payments-<environment>-secret-key`
- `apicenter-payments-<environment>-webhook-secret`
- `apicenter-payments-<environment>-internal-token`

The service is internal-only and publishes the outbox only when
`PUBSUB_DISPATCHER_ENABLED=true`. Build and deploy it through
`infra/gcp/cloud-build/apicenter-payments-cloud-run.yaml`.
