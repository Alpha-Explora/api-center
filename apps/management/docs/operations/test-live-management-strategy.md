# Test And Live Management Strategy

This note records how `apicenter-management` should target test versus live API
Center environments, and why the safer default is separate deployments or env
groups instead of a runtime switch that can mutate production from the same
session.

## Recommendation

Use separate management environments:

- `apicenter-management-test`
- `apicenter-management-live`

Each environment should have its own URL, environment variables, platform admin
secret, GCP identity, Confluent credentials, and operator access policy.

Do not add a live/test write-action switch inside one shared management session
until admin authentication, role checks, write-audit trails, and production
confirmation gates are implemented.

## What Changes For Live

For the management app itself, live targeting is mostly an environment-variable
change:

```env
MANAGEMENT_ENV=live
NEXT_PUBLIC_MANAGEMENT_ENV=live
API_CENTER_BASE_URL=https://api-center.itsandbox.site
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
API_CENTER_PLATFORM_ADMIN_SECRET=<live API Center PLATFORM_ADMIN_SECRET>
GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=prod
CONFLUENT_ENVIRONMENT_ID=<live-env-id>
CONFLUENT_KAFKA_CLUSTER_ID=<live-cluster-id>
CONFLUENT_KAFKA_REST_ENDPOINT=<live-kafka-rest-endpoint>
CONFLUENT_KAFKA_API_KEY=<live-kafka-cluster-api-key>
CONFLUENT_KAFKA_API_SECRET=<live-kafka-cluster-api-secret>
CONFLUENT_CLOUD_API_KEY=<live-cloud-management-api-key>
CONFLUENT_CLOUD_API_SECRET=<live-cloud-management-api-secret>
CONFLUENT_S3_CONNECTOR_NAME=api-center-s3-sink
```

Keep `API_CENTER_PLATFORM_ADMIN_SECRET`, GCP credentials, and Confluent
credentials server-only. Never put platform admin secrets or provider secrets in
`NEXT_PUBLIC_*` variables.

If the app is deployed on Vercel, prefer Workload Identity Federation through
Vercel OIDC instead of a service account JSON key:

```env
GCP_PROJECT_NUMBER=<gcp-project-number>
GCP_SERVICE_ACCOUNT_EMAIL=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_POOL_ID=<pool-id>
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=<provider-id>
```

Local operator use can keep using `GCP_IMPERSONATE_SERVICE_ACCOUNT` with
`gcloud auth login` / service-account impersonation.

## Shared-Service Live Mode

The management app does not directly decide whether PayMongo, email, SMS, OTP,
Google OAuth, or geo calls are test or live. Those modes belong to
`api-shared-services` runtime configuration.

For PayMongo, keep both test and live credentials in the shared-service secret,
then switch the runtime with:

```env
PAYMENT_PROVIDER_MODE=test
```

or:

```env
PAYMENT_PROVIDER_MODE=live
```

The shared-service runtime should be tested in `test` mode first. Enable `live`
only after safe smoke checks, webhook verification, and operator approval.

## Option 1: Separate Deployments

Use one Vercel project/deployment for test and one for live.

Pros:

- Strongest separation between test and production secrets.
- Lower chance of accidentally writing to live while testing.
- Different operator access can be applied per environment.
- Easier to audit because the URL itself implies environment.
- Environment variables can be rotated independently.

Cons:

- Two deployments and two env sets must be maintained.
- Operators need to know which URL to open.
- Shared UI changes must be deployed to both environments.

This is the recommended first production approach.

## Option 2: One Deployment, Startup Env Selects Target

Use one app deployment shape, but deploy or restart it with `APP_ENV=test` or
`APP_ENV=live` and the matching environment variables.

Pros:

- Simpler than maintaining two separate app projects.
- The code path stays identical between test and live.
- Switching target can be done through deployment configuration.

Cons:

- Changing target still requires redeploy or restart.
- A misconfigured env set can point the app at the wrong API Center.
- Access control is harder because the same deployment may become live later.
- Operators may not immediately notice which environment is active unless the
  UI makes it obvious.

This is acceptable for a private operator-only app, but it is weaker than
separate deployments.

## Option 3: UI Switch Inside Management

Add a test/live switch in the management UI.

Pros:

- Very convenient for read-only dashboards.
- Operators can compare test and live without changing URLs.
- Useful later for environment health views and registry diff tools.

Cons:

- Dangerous for write actions.
- A wrong click can register, update, retire, or deregister live services.
- A wrong click can provision live tribe secrets.
- A wrong click can create live Confluent topics or update the live S3 sink.
- Provider-impacting checks could create real payment, email, SMS, or OTP side
  effects if shared services are in live mode.
- Requires a real authorization model, write-audit trails, confirmation gates,
  and per-environment permissions before it is safe.

If a UI switch is added later, start with read-only data only. Keep write actions
bound to the deployment environment until production authorization exists.

## Safe UI Improvements

Add these before any live usage:

- A visible environment badge in the app shell: `TEST` or `LIVE`.
- A distinct live warning style for destructive or provider-impacting actions.
- A readiness check that shows the active API Center URL, topic prefix, GCP
  project, and whether platform admin access works.
- A production confirmation input for live registry writes and lifecycle
  actions.
- A disabled-by-default flag for live provider-impacting smoke checks.

## Practical Path

1. Create `apicenter-management-test` with test API Center, test Confluent
   values, `MANAGEMENT_ENV=test`, `NEXT_PUBLIC_MANAGEMENT_ENV=test`, and
   `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test`.
2. Create `apicenter-management-live` with live API Center, live Confluent
   values, `MANAGEMENT_ENV=live`, `NEXT_PUBLIC_MANAGEMENT_ENV=live`, and
   `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=prod`.
3. Keep both apps private until admin login and role checks are wired.
4. Add an environment badge and readiness summary to reduce operator mistakes.
5. Only consider a UI environment switch after read-only environment comparison
   is useful and write actions have proper authorization.

## Rule Of Thumb

If the action can change registry state, tribe credentials, Confluent topics, S3
sink connector config, deployment state, or provider-backed live data, it should
not depend on a casual UI test/live switch.

Use deployment-level environment separation first. Add convenience later, after
the safety model exists.


