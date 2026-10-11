---
title: "Shared-service database roles"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["supabase/migrations"]
---
# Shared-service database roles

Each shared-service runtime connects to Postgres as its own login user. The login user inherits one
NOLOGIN role, and that role can use only the runtime's own schema. The migration
`20261010060000_runtime_database_roles` creates the roles.

| Role | Schema | Table privileges | Runtime | Secret |
| --- | --- | --- | --- | --- |
| `payments_runtime` | `shared_payment` | SELECT, INSERT, UPDATE | `apps/payments` service and `payment-event-dispatcher` job | `apicenter-payments-database-url-<env>` |
| `email_runtime` | `shared_email` | SELECT, INSERT, UPDATE | `apps/email` | `apicenter-email-database-url-live` |
| `sms_runtime` | `shared_sms` | SELECT, INSERT, UPDATE | `apps/sms` | `apicenter-sms-database-url-live` |
| `otp_runtime` | `shared_otp` | SELECT, INSERT, UPDATE | `apps/otp` | `apicenter-otp-database-url-live` |
| `gauth_runtime` | `shared_gauth` | SELECT, INSERT, UPDATE, DELETE | `apps/gauth` | `apicenter-gauth-database-url-live` |

`<env>` is `test` or `live` for payments. The other shared runtimes use `live`. The email and gauth
runtimes do not query Postgres yet, so their grants are in place for when they do.

## Create a login user for a role

Run this as the migration owner. Choose a long random password and keep it out of the repository.

```sql
CREATE ROLE sms_runtime_login LOGIN PASSWORD '<generated-password>' IN ROLE sms_runtime;
```

Store the full connection string as the secret named in the table, with the login user, password, host and
database. Give the secret's accessor role (`roles/secretmanager.secretAccessor`) only to the Cloud Run service
account that runs that runtime. Payments and its dispatcher use `apicenter-payments-runtime@...`. The other
shared runtimes use `apicenter-shared-services-runtime@...`.

To rotate a password, run `ALTER ROLE sms_runtime_login PASSWORD '<new-password>';` and update the secret.

## Deploy order

1. Apply the Supabase migrations. This creates the five roles and drops `shared_services_app`.
2. Create a login user for each role that will run, and store its connection string in the matching secret.
3. Deploy the manifests in `infra/gcp/cloud-run/`.

Step 1 breaks the payment runtime until step 3 finishes, because dropping `shared_services_app` removes the
membership that the current payment login user depends on. Plan the payment deploy as one step with the migration.

## Check the result

`npm run db:verify:replay` checks that each role can use only its own schema and holds exactly the table privileges
listed above. `npm run db:test:runtime-roles` checks that the roles are refused on other schemas.
