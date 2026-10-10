#!/usr/bin/env node
// Opt-in local PostgreSQL load test for the control-plane write paths whose
// history tables have retention policies. This intentionally does not run in CI.
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL to a fresh replayed local database.');
  process.exit(2);
}

const levels = option('levels', '1,4,8').split(',').map(Number);
const durationSeconds = Number(option('duration-seconds', '2'));
const warmupMs = Number(option('warmup-ms', '250'));
if (!levels.length || levels.some((level) => !Number.isInteger(level) || level < 1 || level > 16)) {
  throw new Error('--levels must contain integers from 1 to 16');
}
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
  throw new Error('--duration-seconds must be between 0 and 30');
}

const runId = randomUUID();
const appName = `apic-history-load-${runId.slice(0, 8)}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 2, application_name: `${appName}-monitor` });
const appPool = new Pool({ connectionString: databaseUrl, max: Math.max(...levels), application_name: appName });
const workloadNames = ['registry', 'quota', 'audit', 'usage-rollup'];
const uuidFor = (worker, sequence) => deterministicUuid(runId, `${worker}:${sequence}`);

async function main() {
  const dbInfo = await adminPool.query('select current_database() as database, version() as version');
  const role = await adminPool.query("select exists(select 1 from pg_roles where rolname = 'api_center_app') as present");
  if (!role.rows[0].present) throw new Error('api_center_app role is missing; replay the migrations first');

  // Registry workflow uses the same transaction boundaries and child-row rewrite
  // as PostgresRegistryStoreService.upsert. Every operation creates/updates a
  // distinct service while upserting the shared default organization.
  const registry = async (client, worker, sequence) => {
    const serviceId = `load-${runId.slice(0, 8)}-${worker}-${sequence}`;
    await client.query('begin');
    try {
      const org = await client.query(
        `insert into apic_catalog.organizations (slug, name) values ('default', 'Default Organization')
         on conflict (slug) do update set slug = excluded.slug returning id`,
      );
      const service = await client.query(
        `insert into apic_catalog.services
           (organization_id, service_id, name, service_type, base_url, health_check_path,
            status, version, tags, registered_at, updated_at)
         values ($1, $2, $2, 'shared', 'http://127.0.0.1:1', '/health', 'active', '1.0.0', '[]'::jsonb, now(), now())
         on conflict (organization_id, service_id) do update set
           name = excluded.name, service_type = excluded.service_type, base_url = excluded.base_url,
           health_check_path = excluded.health_check_path, status = excluded.status,
           version = excluded.version, tags = excluded.tags, updated_at = excluded.updated_at
         returning id`,
        [org.rows[0].id, serviceId],
      );
      const serviceDbId = service.rows[0].id;
      await client.query('delete from apic_catalog.service_routes where service_id = $1', [serviceDbId]);
      await client.query('delete from apic_catalog.service_scopes where service_id = $1', [serviceDbId]);
      await client.query('delete from apic_catalog.service_dependencies where service_id = $1', [serviceDbId]);
      await client.query('insert into apic_catalog.service_routes (service_id, path) values ($1, $2)', [serviceDbId, '/v1/items']);
      await client.query('insert into apic_catalog.service_scopes (service_id, scope) values ($1, $2)', [serviceDbId, 'items:read']);
      await client.query('delete from apic_catalog.service_environments where service_id = $1', [serviceDbId]);
      await client.query(
        `insert into apic_catalog.service_environments
           (service_id, environment, base_url, health_check_path, status, registered_at, updated_at)
         values ($1, 'test', 'http://127.0.0.1:1', '/health', 'active', now(), now())`,
        [serviceDbId],
      );
      await client.query(
        `insert into apic_catalog.service_lifecycle_events (service_id, event_type, next_status, next_version, metadata)
         values ($1, 'updated', 'active', '1.0.0', '{}'::jsonb)`,
        [serviceDbId],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  };

  const quota = async (client, worker, sequence) => {
    await client.query(
      `insert into apic_runtime.quota_evaluations
         (owner_tribe_id, environment, scope, route_family, window_start, window_end,
          request_count, max_requests, mode, outcome, correlation_id)
       values ($1, 'test', 'all', 'registry', date_trunc('minute', now()), date_trunc('minute', now()) + interval '1 minute', 1, 1000, 'observe', 'allowed', $2)`,
      [`load-${worker}`, `${runId}:${sequence}`],
    );
  };

  const audit = async (client, worker, sequence) => {
    await client.query(
      `insert into apic_audit.audit_events
         (id, correlation_id, environment, actor_type, actor_id, action, resource_type,
          resource_id, outcome, metadata, created_at)
       values ($1, $2, 'test', 'system', $3, 'load-test', 'service', $4, 'succeeded', $5::jsonb, now())`,
      [uuidFor(worker, sequence), `${runId}:${sequence}`, `worker-${worker}`, `load-${worker}-${sequence}`,
        JSON.stringify({ actionFamily: 'registration', severity: 'info', message: 'history load test', environment: 'test', correlationId: `${runId}:${sequence}`, payload: {} })],
    );
  };

  // There is currently no gateway writer for apic_runtime.usage_rollups. This
  // models the table's Prisma unique key and additive aggregate upsert directly.
  // Stable non-null service UUIDs make concurrent updates contend on one hourly bucket.
  const consumerId = uuidFor(0, 0);
  const targetId = uuidFor(0, 1);
  const usage = async (client, worker, sequence) => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const latency = 10 + ((worker + sequence) % 90);
    await client.query(
      `insert into apic_runtime.usage_rollups
         (window_start, window_end, environment, consumer_service_id, target_service_id,
          route_family, request_count, success_count, error_count, avg_latency_ms, p95_latency_ms)
       values ($1, $2, 'test', $3, $4, 'shared', 1, 1, 0, $5::numeric, $5::integer)
       on conflict (environment, consumer_service_id, target_service_id, route_family, window_start, window_end)
       do update set
         avg_latency_ms = ((apic_runtime.usage_rollups.avg_latency_ms * apic_runtime.usage_rollups.request_count)
                           + (excluded.avg_latency_ms * excluded.request_count))
                          / (apic_runtime.usage_rollups.request_count + excluded.request_count),
         request_count = apic_runtime.usage_rollups.request_count + excluded.request_count,
         success_count = apic_runtime.usage_rollups.success_count + excluded.success_count,
         error_count = apic_runtime.usage_rollups.error_count + excluded.error_count,
         p95_latency_ms = greatest(apic_runtime.usage_rollups.p95_latency_ms, excluded.p95_latency_ms),
         updated_at = now()`,
      [start, end, consumerId, targetId, latency],
    );
  };

  const operations = { registry, quota, audit, 'usage-rollup': usage };
  const results = [];
  for (const concurrency of levels) {
    for (const name of workloadNames) {
      results.push(await runScenario(name, operations[name], concurrency));
    }
  }

  console.log(JSON.stringify({
    kind: 'apicenter_history_load',
    database: dbInfo.rows[0].database,
    runId,
    appRole: 'api_center_app (SET ROLE on each benchmark connection)',
    appName,
    durationSeconds,
    warmupMs,
    levels,
    note: 'usage-rollup is a table-level representative upsert; no gateway usage_rollups writer currently exists',
    results,
  }, null, 2));
}

async function runScenario(name, operation, concurrency) {
  const clients = await Promise.all(Array.from({ length: concurrency }, async () => {
    const client = await appPool.connect();
    await client.query('set role api_center_app');
    return client;
  }));
  let stopMonitor = false;
  const observations = { peakConnections: 0, peakLockWaiters: 0, lockWaitSamples: 0, pgLocksPeak: 0 };
  const deadlocksBefore = await readDeadlocks();
  const monitor = sampleDatabase(observations, () => stopMonitor);
  let sequenceByWorker = Array(concurrency).fill(0);
  try {
    await executeWindow(clients, operation, name, sequenceByWorker, performance.now() + warmupMs, null);
    const samples = [];
    const started = performance.now();
    const deadline = started + durationSeconds * 1000;
    const counts = await executeWindow(clients, operation, name, sequenceByWorker, deadline, samples);
    const elapsedSeconds = (performance.now() - started) / 1000;
    stopMonitor = true;
    await monitor;
    const deadlocksAfter = await readDeadlocks();
    samples.sort((a, b) => a - b);
    return {
      workload: name,
      concurrency,
      operations: counts,
      throughputOpsPerSecond: round(counts / elapsedSeconds, 2),
      latencyMs: { p50: percentile(samples, 0.50), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99) },
      peakConnections: observations.peakConnections,
      peakLockWaiters: observations.peakLockWaiters,
      sampledLockWaitObservations: observations.lockWaitSamples,
      peakUngrantedLocks: observations.pgLocksPeak,
      deadlocks: deadlocksAfter - deadlocksBefore,
    };
  } finally {
    stopMonitor = true;
    await monitor;
    for (const client of clients) client.release();
  }
}

async function executeWindow(clients, operation, name, sequences, deadline, samples) {
  const workers = clients.map(async (client, worker) => {
    let count = 0;
    while (performance.now() < deadline) {
      const sequence = sequences[worker]++;
      const started = performance.now();
      await operation(client, worker + clients.length * 100, sequence);
      if (samples) samples.push(performance.now() - started);
      count += 1;
    }
    return count;
  });
  const counts = await Promise.all(workers);
  return counts.reduce((sum, count) => sum + count, 0);
}

async function sampleDatabase(observations, shouldStop) {
  while (!shouldStop()) {
    try {
      const activity = await adminPool.query(
        `select count(*) filter (where backend_type = 'client backend') as connections,
                count(*) filter (where wait_event_type = 'Lock') as lock_waiters
         from pg_stat_activity where application_name = $1`, [appName],
      );
      const locks = await adminPool.query(
        `select count(*) as waiting from pg_locks l join pg_stat_activity a on a.pid = l.pid
         where not l.granted and a.application_name = $1`, [appName],
      );
      observations.peakConnections = Math.max(observations.peakConnections, Number(activity.rows[0].connections));
      const waiters = Number(activity.rows[0].lock_waiters);
      observations.peakLockWaiters = Math.max(observations.peakLockWaiters, waiters);
      if (waiters > 0) observations.lockWaitSamples += 1;
      observations.pgLocksPeak = Math.max(observations.pgLocksPeak, Number(locks.rows[0].waiting));
    } catch (error) {
      console.error(`monitor sample failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function readDeadlocks() {
  const result = await adminPool.query(
    `select deadlocks from pg_stat_database where datname = current_database()`,
  );
  return Number(result.rows[0].deadlocks);
}

function percentile(sortedSamples, p) {
  if (!sortedSamples.length) return null;
  return round(sortedSamples[Math.max(0, Math.ceil(sortedSamples.length * p) - 1)], 3);
}
function round(value, digits) { return Number(value.toFixed(digits)); }
function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function deterministicUuid(namespace, value) {
  const hex = require('node:crypto').createHash('sha256').update(`${namespace}:${value}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all([appPool.end(), adminPool.end()]);
});
