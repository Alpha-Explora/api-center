# APICenter Payment Pub/Sub Plans

These manifests describe the APICenter-owned payment event topology. They are
inputs to the future Management provisioning worker, not direct gcloud YAML.

Each environment has:

- one payment event topic with 31-day message retention;
- one dead-letter topic and subscription;
- a 20-attempt dead-letter policy;
- a dedicated Cloud Run delivery service account;
- one filtered push subscription per registered consumer service.

The provisioning worker must resolve endpoint and project placeholders from the
APICenter control plane, verify HTTPS and environment ownership, create the
topic/subscription resources idempotently, and grant roles/run.invoker only
to the delivery service account on the registered endpoint.



The canonical topics are apicenter.payment-events.test and apicenter.payment-events.live. Delivery endpoints must be HTTPS Cloud Run run.app URLs; the delivery service account is granted roles/run.invoker only on the registered consumer endpoint by the provisioning worker.