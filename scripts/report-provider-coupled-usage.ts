#!/usr/bin/env ts-node
// Reports which projects use API features tied to a provider, so each deprecation or ID replacement in
// the provider-neutral plan reaches the projects it affects. Read-only: every query runs inside a
// READ ONLY transaction.
//
//   npx ts-node scripts/report-provider-coupled-usage.ts --database-url <url> [--days 90]

const { Client } = require("pg");

type Row = Record<string, string | number | null>;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sections: Array<{ title: string; sql: string }> = [
  {
    title: "Payment records whose IDs the migration replaces",
    sql: `SELECT environment, project_id, resource_type, count(*)::int AS records
            FROM shared_payment.resource_owners GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  },
  {
    title: "Payment intents past creation (the provider's client-side confirm flow)",
    sql: `SELECT environment, project_id, count(*)::int AS intents
            FROM shared_payment.resource_owners
           WHERE resource_type = 'intent' AND created_at >= now() - make_interval(days => $1)
             AND coalesce(snapshot->>'status', status, '') NOT IN ('', 'awaiting_payment_method')
           GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    title: "SMS messages whose IDs the migration replaces",
    sql: `SELECT environment, project_id, count(*)::int AS messages
            FROM shared_sms.sms_messages GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    title: "Geocoding calls (results gain neutral fields; placeId, types, provider and raw are deprecated)",
    sql: `SELECT environment_id, project_id, action, count(*)::int AS calls
            FROM apic_catalog.cp_usage_records
           WHERE action IN ('geo:geocode', 'geo:reverse-geocode') AND created_at >= now() - make_interval(days => $1)
           GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  },
  {
    title: "Email sends (the response's provider field is deprecated)",
    sql: `SELECT environment_id, project_id, count(*)::int AS sends
            FROM apic_catalog.cp_usage_records
           WHERE action = 'email:send' AND created_at >= now() - make_interval(days => $1)
           GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    title: "Event destinations by transport (webhook becomes the default)",
    sql: `SELECT environment_id, project_id, transport, status, count(*)::int AS destinations
            FROM apic_catalog.cp_event_destinations GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
  },
  {
    title: "Payees with a provider_wallet destination (deprecated for the wallet type)",
    sql: `SELECT environment, project_id, count(*)::int AS payees
            FROM shared_payment.payees WHERE destination->>'type' = 'provider_wallet'
           GROUP BY 1, 2 ORDER BY 1, 2`,
  },
];

function print(title: string, rows: Row[]): void {
  console.log(`\n## ${title}\n`);
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  const columns = Object.keys(rows[0]);
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`|${columns.map(() => "---").join("|")}|`);
  for (const row of rows) console.log(`| ${columns.map((column) => String(row[column] ?? "")).join(" | ")} |`);
}

async function main(): Promise<void> {
  const databaseUrl = argument("database-url") ?? process.env.DATABASE_URL;
  const days = Number(argument("days") ?? 90);
  if (!databaseUrl) throw new Error("Pass --database-url or set DATABASE_URL");
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("--days must be a whole number from 1 to 3650");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    console.log(`# Provider-coupled usage (last ${days} days where dated)`);
    for (const section of sections) {
      const values = section.sql.includes("$1") ? [days] : [];
      const result = await client.query(section.sql, values);
      print(section.title, result.rows);
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
