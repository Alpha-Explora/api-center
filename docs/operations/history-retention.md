# History retention

Several tables only ever grow: audit events, quota evaluations, usage rollups, health snapshots, smoke test runs, pipeline feedback actions and promotion evidence. Each one declares its retention window in its table comment, for example `retention=400d`. `scripts/purge-expired-history.cjs` deletes rows older than that window, and the comment is the single source of the number.

| Table | Dated by | Window |
| --- | --- | --- |
| `apic_audit.audit_events` | `created_at` | 400 days |
| `apic_runtime.quota_evaluations` | `created_at` | 180 days |
| `apic_runtime.usage_rollups` | `window_end` | 400 days |
| `apic_runtime.health_snapshots` | `checked_at` | 90 days |
| `apic_runtime.smoke_test_runs` | `created_at` | 180 days |
| `apic_runtime.pipeline_feedback_actions` | `created_at` | 365 days |
| `apic_governance.promotion_evidence_bundles` | `created_at` | 400 days |

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

The job runs from its own small image, `docker/Dockerfile.history-purge`, which holds only the script and the `pg` driver. The manifest is `infra/gcp/cloud-run/history-purge.yaml`. It ships with `--dry-run` in its args, so the first executions report what would be deleted and delete nothing.

1. Build and push the image from the repository root:

   ```powershell
   docker build -f docker/Dockerfile.history-purge -t asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/apicenter-history-purge:latest .
   docker push asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/apicenter-history-purge:latest
   ```

2. Create the login role (SQL above) and store its connection string in Secret Manager as `apicenter-history-purge-database-url`. Create the service account `apicenter-history-purge` and grant it `roles/secretmanager.secretAccessor` on that secret.
3. Deploy the job and run it once by hand:

   ```powershell
   gcloud run jobs replace infra/gcp/cloud-run/history-purge.yaml --region asia-southeast1
   gcloud run jobs execute apicenter-history-purge --region asia-southeast1 --wait
   ```

4. Read the `apicenter_history_purge` log line. When the counts look right, remove the `--dry-run` argument from the manifest, run `replace` again, and add a Cloud Scheduler job that posts to `https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/apicenter-history-purge:run` once a day with an OAuth token from a service account that holds `roles/run.invoker` on the job.

The names in the manifest (project, service account, secret, image repository) follow the existing payment dispatcher manifests. Change them if your environment uses others.

## Indexes

The purge filters on each table's dated column. `audit_events` already has a btree index on `created_at`. The other tables get a BRIN index on their dated column: they are written in time order, so BRIN stays small and keeps batches from scanning the whole table.

## Not covered here

Partitioning and capacity are separate decisions. Partition a table when its measured volume justifies it, not by default.

