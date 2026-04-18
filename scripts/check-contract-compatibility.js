#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const contractPath = path.join(repoRoot, 'docs', 'contracts', 'shared-service-contract.json');
const sharedControllerPath = path.join(repoRoot, 'src', 'shared-services', 'shared-services.controller.ts');
const kafkaControllerPath = path.join(repoRoot, 'src', 'kafka-governance', 'kafka-governance.controller.ts');
const externalPolicyPath = path.join(repoRoot, 'src', 'external', 'guards', 'external-policy.guard.ts');

const violations = [];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function assertFileExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`Missing required file: ${relativePath}`);
    return false;
  }

  return true;
}

function collectManifestDriftViolations() {
  const forbiddenDirectories = [
    path.join(repoRoot, 'examples'),
    path.join(repoRoot, 'docs'),
  ];

  for (const directory of forbiddenDirectories) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.name.endsWith('.json')) {
          continue;
        }

        try {
          const parsed = readJson(fullPath);
          if (parsed.serviceType === 'shared') {
            const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
            violations.push(
              `Shared manifest drift detected in api-center repository: ${relPath}`,
            );
          }
        } catch {
          // Ignore invalid JSON files; this check is only for drift detection.
        }
      }
    }
  }
}

function runContractChecks() {
  if (!assertFileExists('docs/contracts/shared-service-contract.json')) {
    return;
  }

  const contract = readJson(contractPath);

  if (!assertFileExists('src/shared-services/shared-services.controller.ts')) {
    return;
  }
  if (!assertFileExists('src/kafka-governance/kafka-governance.controller.ts')) {
    return;
  }
  if (!assertFileExists('src/external/guards/external-policy.guard.ts')) {
    return;
  }

  const sharedControllerSource = readText(sharedControllerPath);
  if (!sharedControllerSource.includes("@Controller('shared')")) {
    violations.push("Shared services controller is missing @Controller('shared').");
  }

  const kafkaControllerSource = readText(kafkaControllerPath);

  if (!kafkaControllerSource.includes("@Controller('kafka')")) {
    violations.push("Kafka governance controller is missing @Controller('kafka').");
  }

  if (!kafkaControllerSource.includes("@Post('publish')")) {
    violations.push("Kafka governance controller is missing @Post('publish') endpoint.");
  }

  if (!kafkaControllerSource.includes("@Get('governance')")) {
    violations.push("Kafka governance controller is missing @Get('governance') endpoint.");
  }

  if (!kafkaControllerSource.includes("@Get('schemas')")) {
    violations.push("Kafka governance controller is missing @Get('schemas') endpoint.");
  }

  const externalPolicySource = readText(externalPolicyPath);
  for (const scope of contract.kafkaGovernance?.requiredScopes || []) {
    if (!externalPolicySource.includes(scope)) {
      violations.push(`External policy guard is missing required Kafka scope: ${scope}`);
    }
  }

  collectManifestDriftViolations();
}

function main() {
  runContractChecks();

  if (violations.length === 0) {
    console.log('Contract compatibility check passed.');
    process.exit(0);
  }

  console.error('\nContract compatibility check failed:\n');
  for (const violation of violations) {
    console.error(` - ${violation}`);
  }
  process.exit(1);
}

main();
