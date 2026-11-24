#!/usr/bin/env ts-node
// Exports one project's replaced payment IDs (old provider-derived ID → APICenter ID) as CSV, for a product
// that stored old IDs before migration 20261124001700. Read-only. The mapping is purged after 90 days.
//
//   npx ts-node scripts/export-payment-id-mapping.ts --database-url <url> --environment live --project <projectId>

const { Client } = require("pg");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const databaseUrl = argument("database-url") ?? process.env.DATABASE_URL;
  const environment = argument("environment");
  const projectId = argument("project");
  if (!databaseUrl) throw new Error("Pass --database-url or set DATABASE_URL");
  if (environment !== "test" && environment !== "live") throw new Error("--environment must be test or live");
  if (!projectId) throw new Error("Pass --project <projectId>");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(
      `SELECT resource_type, old_id, new_id, replaced_at FROM shared_payment.payment_id_replacements
        WHERE environment = $1 AND project_id = $2 ORDER BY resource_type, old_id`,
      [environment, projectId],
    );
    await client.query("ROLLBACK");
    console.log("resource_type,old_id,new_id,replaced_at");
    for (const row of rows) {
      console.log([row.resource_type, row.old_id, row.new_id, new Date(row.replaced_at).toISOString()].join(","));
    }
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
