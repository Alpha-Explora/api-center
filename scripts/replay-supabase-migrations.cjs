#!/usr/bin/env node
/**
 * Replays every supabase/migrations/*.sql file, in order, against an EMPTY database.
 *
 * Use it to prove the migration chain builds the control-plane schema from scratch. It refuses to run
 * when APIC schemas already exist, so it cannot be pointed at a live database by mistake.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/replay node scripts/replay-supabase-migrations.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');
const guardedSchemas = [
  'api_center',
  'api_center_ops',
  'api_center_audit',
  'apic_catalog',
  'apic_governance',
  'apic_runtime',
  'apic_audit',
  'shared_payment',
  'shared_email',
  'shared_sms',
  'shared_otp',
  'shared_geo',
  'shared_gauth',
];
// Roles that managed Supabase provides and that migrations grant to or revoke from.
const requiredRoles = ['anon', 'authenticated', 'service_role', 'api_center_app'];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to replay migrations.');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query(
      'select nspname from pg_namespace where nspname = any($1::text[]) order by nspname',
      [guardedSchemas],
    );
    if (existing.rows.length > 0) {
      const names = existing.rows.map((row) => row.nspname).join(', ');
      throw new Error('Refusing to replay: database already has APIC schemas (' + names + '). Use an empty database.');
    }

    for (const role of requiredRoles) {
      const found = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      if (found.rows.length === 0) await client.query('create role ' + role + ' nologin');
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query(sql);
      } catch (error) {
        throw new Error('Migration ' + file + ' failed: ' + (error instanceof Error ? error.message : String(error)));
      }
      console.log('applied ' + file);
    }
    console.log('Replayed ' + files.length + ' migrations onto an empty database.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
