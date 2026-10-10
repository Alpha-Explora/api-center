---
title: "History write load test"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["supabase/migrations"]
---
# History write load test

This opt-in benchmark exercises writes to the control-plane tables covered by
the retention policy. It is intentionally excluded from CI because its timing
depends on the local Postgres host.

## Run it

Replay the migrations to a fresh local database, then run the benchmark as the
application role:

```powershell
$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:55450/<database>'
npm run db:verify:replay
npm run db:load:history
```

The benchmark connects as the local database administrator and executes
`SET ROLE api_center_app` on each measured connection. It tests registration
using the gateway registry store's transaction and child-row rewrite, quota
evaluation and audit event inserts using the gateway's Prisma create fields,
and an additive hourly usage-rollup upsert. The gateway currently has no writer
for `apic_runtime.usage_rollups`; that case tests the table's unique key and
aggregate update behavior directly. All usage workers update one bucket to
make concurrent row contention visible.

Defaults are two seconds of measurement after a 250 ms warmup at concurrency
1, 4, and 8 for each workflow. `--duration-seconds=N` and
`--levels=1,4,8` can adjust the run. The output is JSON. Latency measures a
complete operation, including the registry transaction. A 50 ms sampler reads
`pg_stat_activity` and `pg_locks`; deadlocks come from `pg_stat_database`.
Lock-wait observations count samples where at least one benchmark connection
was waiting on a lock.

## Measurement: 2026-10-10

Measured against `apic_l5b_63_20261010c` on the local `apic-pg-lanes` Docker
Postgres instance after replaying all 42 migrations. The database was empty
before the run. Each scenario ran for two seconds after warmup. Latencies are
milliseconds; throughput is completed operations per second. Lock column is
`peak waiters / samples with a waiter / deadlocks`.

| Workflow | Clients | Ops/s | p50 | p95 | p99 | Peak connections | Lock waiters / samples / deadlocks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Registry transaction | 1 | 69.88 | 13.956 | 16.977 | 18.545 | 1 | 0 / 0 / 0 |
| Quota evaluation | 1 | 388.63 | 2.498 | 3.115 | 3.952 | 1 | 0 / 0 / 0 |
| Audit event | 1 | 331.73 | 2.947 | 3.835 | 4.669 | 1 | 0 / 0 / 0 |
| Usage rollup upsert | 1 | 297.00 | 3.226 | 4.246 | 5.629 | 1 | 0 / 0 / 0 |
| Registry transaction | 4 | 66.66 | 33.127 | 151.700 | 290.144 | 4 | 3 / 37 / 0 |
| Quota evaluation | 4 | 1,237.98 | 3.008 | 4.447 | 6.211 | 4 | 0 / 0 / 0 |
| Audit event | 4 | 1,247.22 | 2.866 | 4.286 | 5.345 | 4 | 0 / 0 / 0 |
| Usage rollup upsert | 4 | 680.92 | 2.891 | 21.066 | 46.393 | 4 | 3 / 40 / 0 |
| Registry transaction | 8 | 79.05 | 28.191 | 385.011 | 560.306 | 8 | 7 / 42 / 0 |
| Quota evaluation | 8 | 2,053.41 | 3.578 | 4.622 | 8.081 | 8 | 0 / 0 / 0 |
| Audit event | 8 | 2,303.02 | 3.524 | 4.442 | 5.968 | 8 | 0 / 0 / 0 |
| Usage rollup upsert | 8 | 594.02 | 3.377 | 70.474 | 166.448 | 8 | 7 / 39 / 0 |

The registry benchmark's organization upsert serializes concurrent operations
on the default organization row. The rollup test shows the expected hot-row
waits when all clients update one aggregate. Neither path deadlocked. Peak
connections matched the configured client count. After the run, Docker reported
168.1 MiB for the database container; this is a post-run snapshot, not a sampled
peak-memory measurement.

## Partitioning decision

Keep the current nonpartitioned tables and dated-column indexes for now. The
planning envelope used here is 10,000 routed requests per day, with a
conservative one audit event and one quota evaluation per request. That yields
about 4.0 million retained audit rows at 400 days and 1.8 million quota rows at
180 days. For usage rollups, assume 250 active environment/consumer/target/route
tuples per hour: about 6,000 new rollup rows per day, or 2.4 million at 400
days. These are planning assumptions, not observed production counts. The
benchmark's single-client writes exceeded the average rate implied by this
envelope; however, the local database and short run do not establish production
capacity. The existing audit btree and BRIN indexes on the other dated tables
let retention purges find time ranges without adding partition-management
overhead at this estimated scale.

Revisit monthly time partitions if observed row counts or traffic materially
exceed this envelope, especially if a history table approaches tens of millions
of retained rows or purge batches stop meeting their operational window. The
usage result also warrants a separate review before introducing a gateway
rollup writer: a shared hourly bucket develops lock waits as concurrency rises.
