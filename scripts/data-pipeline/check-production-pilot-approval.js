#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

require("ts-node/register");

const { checkProductionPilotApproval } = require(
  path.resolve(
    __dirname,
    "../../src/data-pipeline/production-pilot-approval-checker.ts",
  ),
);

function parseArgs(argv) {
  let approvalFile = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-ApprovalFile" || arg === "--approval-file") {
      approvalFile = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!approvalFile) {
    throw new Error("-ApprovalFile is required.");
  }
  return { approvalFile };
}

function main() {
  try {
    const { approvalFile } = parseArgs(process.argv.slice(2));
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), approvalFile),
      "utf8",
    );
    const result = checkProductionPilotApproval(JSON.parse(raw));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
