#!/usr/bin/env node

const path = require("node:path");

require("ts-node/register");

const { generateTribeCuratedSql } = require(
  path.resolve(
    __dirname,
    "../../src/data-pipeline/tribe-curated-sql-generator.ts",
  ),
);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "-DryRun" || arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const key = {
      "-TribeId": "tribeId",
      "--tribe-id": "tribeId",
      "-Environment": "environment",
      "--environment": "environment",
      "-EventType": "eventType",
      "--event-type": "eventType",
      "-MetricName": "metricName",
      "--metric-name": "metricName",
      "-Owner": "owner",
      "--owner": "owner",
      "-Steward": "steward",
      "--steward": "steward",
      "-ApprovedReaderGroup": "approvedReaderGroup",
      "--approved-reader-group": "approvedReaderGroup",
      "-Year": "year",
      "--year": "year",
      "-Month": "month",
      "--month": "month",
      "-Day": "day",
      "--day": "day",
    }[arg];

    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    options[key] = next;
    index += 1;
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const now = new Date();
    const result = generateTribeCuratedSql({
      ...options,
      year: options.year ?? String(now.getUTCFullYear()),
      month: options.month ?? String(now.getUTCMonth() + 1).padStart(2, "0"),
      day: options.day ?? String(now.getUTCDate()).padStart(2, "0"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
