#!/usr/bin/env ts-node
import { getCountries, getCountryCallingCode } from "libphonenumber-js";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the read-only report");
  const codes = [...new Set([...getCountries().map((country) => getCountryCallingCode(country)), "800", "808", "870", "878", "881", "882", "883", "888", "979"])]
    .map((code) => `+${code}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 6000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('apicenter.scope', 'platform', true)");
    const result = await client.query(
      `WITH outgoing AS (
         SELECT tribe_id, project_id, environment, recipient AS target, 'sms' AS service
           FROM shared_sms.sms_messages
           WHERE created_at >= now() - interval '90 days' AND provider_message_id IS NOT NULL
         UNION ALL
         SELECT tribe_id, project_id, environment, target, 'otp' AS service FROM shared_otp.otp_challenges
           WHERE created_at >= now() - interval '90 days' AND channel = 'sms'
       )
       SELECT COALESCE(owner.project_id, outgoing.project_id) AS project_id, environment, service,
         COALESCE(country.prefix, 'unknown') AS calling_code, count(*)::int AS sends
       FROM outgoing
       LEFT JOIN apic_catalog.cp_resource_owner_mappings AS owner ON owner.owner_group_id = outgoing.tribe_id
         AND owner.owner_project_id = outgoing.project_id AND owner.environment_kind = outgoing.environment
       LEFT JOIN LATERAL (
         SELECT prefix FROM unnest($1::text[]) AS calling(prefix)
           WHERE starts_with(outgoing.target, prefix) ORDER BY length(prefix) DESC LIMIT 1
       ) country ON true
       WHERE NOT starts_with(target, '+63')
       GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`, [codes],
    );
    console.log(JSON.stringify(result.rows, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The read-only SMS report failed");
  process.exitCode = 1;
});
