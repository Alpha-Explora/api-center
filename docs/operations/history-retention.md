---
title: "History retention"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["supabase/migrations"]
---
# History retention

Several tables only ever grow: audit events, quota evaluations, usage rollups and pipeline feedback actions. Each one declares its retention window in its table comment, for example `retention=400d`. `scripts/purge-expired-history.cjs` deletes rows older than that window, and the comment is the single source of the number.

| Table | Dated by | Window |
| --- | --- | --- |
| `apic_audit.audit_events` | `created_at` | 400 days |
| `apic_runtime.quota_evaluations` | `created_at` | 180 days |
| `apic_runtime.usage_rollups` | `window_end` | 400 days |
| `apic_runtime.pipeline_feedback_actions` | `created_at` | 365 days |
| `apic_catalog.cp_usage_records` | `created_at` | 90 days |
| `apic_catalog.cp_quota_counters` | `window_start` | 62 days |
| `apic_catalog.cp_credential_operations` | `created_at` | 30 days |

The script also purges the runtimes' delivery events, webhook delivery history, idempotency keys and rate-limit windows, each by its own table comment; `MANAGED_TABLES` in the script is the full list. A listed table that no longer exists is reported as `absent` and does not fail the run. Control-plane tables use row-level security, so each has a policy that lets `api_center_retention` read and delete every row (migration `20261120001080`).

To change a window, change the table comment in a migration. The verifier (`--require-retention-policy`) fails when a managed table has no policy.

## Running the purge

Run it as a scheduled job under the `api_center_retention` role. Audit events are append-only for the application role (`api_center_app`), so the purge must not run as the application.

```sql
-- once per environment, with a real password from Secret Manager
create role apicenter_purge login password '...' in role api_center_retention;
```

```bash
# See what would be deleted
DATABASE_URL=postgres://apicenter_purge:...@HOST/DB node scripts/purge-expired-history.cjs --dry-run

# Delete expired rows in batches of 5000 (each batch is its own transaction)
DATABASE_URL=postgres://apicenter_purge:...@HOST/DB node scripts/purge-expired-history.cjs
```

The job prints one JSON line (`apicenter_history_purge`) with the rows deleted per table. It exits 1 when a managed table has no retention policy, and it never purges that table.

## Deploying the job

The job runs from its own small image, `docker/Dockerfile.history-purge`, which holds only the script and the `pg` driver. The manifest is `infra/gcp/cloud-run/history-purge.yaml`. In a new environment, add `--dry-run` to its args for the first executions, so they report what would be deleted and delete nothing.

1. Build and push the image from the repository root:

   ```powershell
   docker build -f docker/Dockerfile.history-purge -t asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/apicenter-history-purge:latest .
   docker push asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/apicenter-history-purge:latest
   ```

2. Create the login role (SQL above) and store its connection string in Secret Manager as `apicenter-history-purge-database-url`. Create the service account `apicenter-history-purge` and grant it `roles/secretmanager.secretAccessor` on that secret.
3. Deploy the job and run it once by hand:

   ```powershell
   gcloud run jobs replace infra/gcp/cloud-run/history-purge.yaml --region australia-southeast1
   gcloud run jobs execute apicenter-history-purge --region australia-south4. Read the `apicenter_history_purge` log line. When the counts look right, remove `--dry-run`, run `replace` again, and schedule the job daily. The scheduler's service account needs `roles/run.invoker` on the job:

   ```powershell
   gcloud iam service-accounts create apicenter-purge-scheduler --display-name="Triggers the history purge job"
   gcloud run jobs add-iam-policy-binding apicenter-history-purge --region australia-southeast1 --member="serviceAccount:apicenter-purge-scheduler@PROJECT_ID.iam.gserviceaccount.com" --role=roles/run.invoker
   gcloud scheduler jobs create http apicenter-history-purge-daily --location australia-southeast1 --schedule="0 3 * * *" --time-zone="Asia/Manila" --http-method=POST --uri="https://run.googleapis.com/v2/projects/PROJECT_ID/locations/australia-southeast1/jobs/apicenter-history-purge:run" --oauth-service-account-email=apicenter-purge-scheduler@PROJECT_ID.iam.gserviceaccount.com --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
   ```

In `apicenter-alpha-20260623` the job runs for real (no `--dry-run`) every day at 03:00 Asia/Manila..invoker` on the job.

The job runs in `australia-southeast1`, beside the database. The names in the manifest (project, service account, secret, image repository) follow the existing payment dispatcher manifests. Change them if your environment uses others.

## Indexes

The purge filters on each table's dated column. `audit_events` already has a btree index on `created_at`. The other tables get a BRIN index on their dated column: they are written in time order, so BRIN stays small and keeps batches from scanning the whole table.

## Not covered here

Partitioning and capacity are separate decisions. Partition a table when its measured volume justifies it, not by default.
The repeatable local load test, measurements, and current partitioning decision are recorded in [history-load-test.md](history-load-test.md).

