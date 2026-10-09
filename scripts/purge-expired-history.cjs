#!/usr/bin/env node
/**
 * Deletes history rows older than the retention window declared in each table comment
 * ("retention=400d; ..."). Run it as a scheduled job under the api_center_retention role:
 *
 *   DATABASE_URL=postgres://apicenter_purge:...@host/db node scripts/purge-expired-history.cjs [--dry-run] [--batch-size 5000]
 *
 * A table without a retention comment is never purged and the job exits 1, so a missing policy is noticed.
 * Rows are deleted in batches, each in its own transaction, so a purge never holds a long lock.
 */
const { Client } = require('pg');

// The only tables this job may touch, and the column that dates a row. Identifiers are constants.
const MANAGED_TABLES = [
  { schema: 'apic_audit', table: 'audit_events', column: 'created_at' },
  { schema: 'apic_runtime', table: 'quota_evaluations', column: 'created_at' },
  { schema: 'apic_runtime', table: 'usage_rollups', column: 'window_end' },
  { schema: 'apic_runtime', table: 'pipeline_feedback_actions', column: 'created_at' },
];

/** Reads the number of days from a comment such as "retention=400d; partition=monthly". */
function parseRetentionDays(comment) {
  const match = /(?:^|[;\s])retention=(\d+)d(?=$|[;\s])/.exec(comment || '');
  const days = match ? Number(match[1]) : 0;
  return days > 0 ? days : null;
}

async function purgeExpiredHistory(client, { batchSize = 5000, maxBatches = 1000, dryRun = false } = {}) {
  const results = [];
  for (const { schema, table, column } of MANAGED_TABLES) {
    const qualified = schema + '.' + table;
    const comment = await client.query("select obj_description(to_regclass($1), 'pg_class') as comment", [qualified]);
    const retentionDays = parseRetentionDays(comment.rows[0] && comment.rows[0].comment);
    if (!retentionDays) {
      results.push({ table: qualified, skipped: 'no retention policy in the table comment' });
      continue;
    }

    if (dryRun) {
      const eligible = await client.query(
        'select count(*)::int as eligible from ' + qualified + ' where ' + column + ' < now() - make_interval(days => $1)',
        [retentionDays],
      );
      results.push({ table: qualified, retentionDays, eligible: eligible.rows[0].eligible });
      continue;
    }

    let deleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await client.query(
        'delete from ' + qualified + ' where ctid = any (array(select ctid from ' + qualified
          + ' where ' + column + ' < now() - make_interval(days => $1) order by ' + column + ' limit $2))',
        [retentionDays, batchSize],
      );
      deleted += result.rowCount;
      if (result.rowCount < batchSize) break;
    }
    results.push({ table: qualified, retentionDays, deleted });
  }
  return results;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const args = process.argv.slice(2);
  const sizeIndex = args.indexOf('--batch-size');
  const batchSize = sizeIndex === -1 ? 5000 : Number(args[sizeIndex + 1]);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100000) throw new Error('--batch-size must be an integer from 1 to 100000');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const results = await purgeExpiredHistory(client, { batchSize, dryRun: args.includes('--dry-run') });
    console.log(JSON.stringify({ type: 'apicenter_history_purge', dryRun: args.includes('--dry-run'), results }));
    if (results.some((result) => result.skipped)) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { MANAGED_TABLES, parseRetentionDays, purgeExpiredHistory };

