#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const violations = [];

function assertFileExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`Missing required file: ${relativePath}`);
    return null;
  }
  return absolutePath;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function collectManifestDriftViolations() {
  for (const directory of ['examples', 'docs']) {
    const root = path.join(repoRoot, directory);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.name.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (parsed.serviceType === 'shared') {
            violations.push(`Shared manifest drift detected in api-center repository: ${path.relative(repoRoot, fullPath)}`);
          }
        } catch {
          // Ignore unrelated JSON artifacts; this check only guards manifest drift.
        }
      }
    }
  }
}

function runContractChecks() {
  const sharedController = assertFileExists('apps/gateway/src/shared-services/shared-services.controller.ts');
  const kafkaController = assertFileExists('apps/gateway/src/kafka-governance/kafka-governance.controller.ts');
  const externalPolicy = assertFileExists('apps/gateway/src/external/guards/external-policy.guard.ts');
  if (!sharedController || !kafkaController || !externalPolicy) return;

  const checks = [
    [readText('apps/gateway/src/shared-services/shared-services.controller.ts'), /@Controller\(["']shared["']\)/, "Shared services controller is missing @Controller('shared')."],
    [readText('apps/gateway/src/kafka-governance/kafka-governance.controller.ts'), /@Controller\(["']kafka["']\)/, "Kafka governance controller is missing @Controller('kafka')."],
    [readText('apps/gateway/src/kafka-governance/kafka-governance.controller.ts'), /@Post\(["']publish["']\)/, "Kafka governance controller is missing @Post('publish') endpoint."],
    [readText('apps/gateway/src/kafka-governance/kafka-governance.controller.ts'), /@Get\(["']governance["']\)/, "Kafka governance controller is missing @Get('governance') endpoint."],
    [readText('apps/gateway/src/kafka-governance/kafka-governance.controller.ts'), /@Get\(["']schemas["']\)/, "Kafka governance controller is missing @Get('schemas') endpoint."],
  ];
  for (const [source, pattern, message] of checks) {
    if (!pattern.test(source)) violations.push(message);
  }
}

function collectSharedContractViolations() {
  const contractPath = path.join(repoRoot, 'packages/contracts/shared-service-contract.json');
  if (!fs.existsSync(contractPath)) return;
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  for (const service of contract.sharedServices ?? []) {
    if (typeof service.manifest !== 'string') {
      violations.push('Shared service ' + service.serviceId + ' is missing a manifest path.');
      continue;
    }
    if (!fs.existsSync(path.join(repoRoot, service.manifest))) {
      violations.push('Shared service ' + service.serviceId + ' references missing manifest: ' + service.manifest);
    }
  }
}

runContractChecks();
collectManifestDriftViolations();
collectSharedContractViolations();
if (violations.length > 0) {
  console.error('\nContract compatibility check failed:\n');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}
console.log('Contract compatibility check passed.');