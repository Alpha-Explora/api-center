// Fails when the plan catalogue in code and the apic_governance.entitlement_plans seed disagree.
// Runs against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:plan-definitions
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';

test('the code plan catalogue equals the entitlement_plans seed', { skip }, async () => {
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
  const { PLAN_DEFINITIONS } = require(path.resolve(
    __dirname, '../../apps/gateway/src/domains/governance/entitlements/tribe-plan-definitions.ts'));

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await pool.query(
      `SELECT plan_key AS "planKey", display_name AS "displayName",
              gateway_calls_per_day AS "gatewayCallsPerDay", kafka_publishes_per_day AS "kafkaPublishesPerDay",
              retention_tier AS "retentionTier", shared_service_access AS "sharedServiceAccess",
              support_tier AS "supportTier"
       FROM apic_governance.entitlement_plans ORDER BY plan_key`);
    const byKey = (a, b) => a.planKey.localeCompare(b.planKey);
    assert.deepEqual(rows, [...PLAN_DEFINITIONS].sort(byKey));
  } finally { await pool.end(); }
});
