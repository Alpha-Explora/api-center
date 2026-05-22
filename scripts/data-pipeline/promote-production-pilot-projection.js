#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

require("ts-node/register");

const { planProductionPilotProjectionPromotion } = require(
  path.resolve(
    __dirname,
    "../../src/data-pipeline/production-pilot-projection-promoter.ts",
  ),
);

function parseArgs(argv) {
  const options = {
    approvalFile: "",
    topicsFile: "infra/aws-data-pipeline/topic-projection-values.txt",
    rawTopicTablesSql:
      "infra/aws-data-pipeline/catalog/raw-topic-tables.sql",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-ApprovalFile" || arg === "--approval-file") {
      options.approvalFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "-TopicsFile" || arg === "--topics-file") {
      options.topicsFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "-RawTopicTablesSql" || arg === "--raw-topic-tables-sql") {
      options.rawTopicTablesSql = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "-DryRun" || arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.approvalFile) {
    throw new Error("-ApprovalFile is required.");
  }

  return options;
}

function readTopicsFile(filePath) {
  return fs
    .readFileSync(path.resolve(process.cwd(), filePath), "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const approval = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), options.approvalFile), "utf8"),
    );
    const topics = readTopicsFile(options.topicsFile);
    const rawTopicTablesSql = fs.readFileSync(
      path.resolve(process.cwd(), options.rawTopicTablesSql),
      "utf8",
    );

    const result = planProductionPilotProjectionPromotion({
      approval,
      topics,
      rawTopicTablesSql,
    });

    console.log(JSON.stringify({
      ok: result.ok,
      dry_run: options.dryRun,
      changed: result.changed,
      approved_topic: result.approvedTopic,
      topic_count: result.topics.length,
      errors: result.errors,
      warnings: result.warnings,
    }, null, 2));

    if (!result.ok) process.exit(1);
    if (options.dryRun || !result.changed) return;

    fs.writeFileSync(
      path.resolve(process.cwd(), options.topicsFile),
      `${result.topics.join("\n")}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.resolve(process.cwd(), options.rawTopicTablesSql),
      result.rawTopicTablesSql,
      "utf8",
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
