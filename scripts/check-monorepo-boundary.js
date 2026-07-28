const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "apps/gateway/src/main.ts",
  "apps/gateway/package.json",
  "apps/gateway/tsconfig.json",
  "apps/payments/package.json",
  "apps/management/package.json",
  "packages/contracts/package.json",
  "packages/sdk/package.json",
];

const missing = required.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
if (fs.existsSync(path.join(root, "src"))) {
  missing.push("root src/ must remain absent after the gateway move");
}

if (missing.length > 0) {
  console.error("APICenter monorepo boundary check failed:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("APICenter monorepo boundary check passed.");