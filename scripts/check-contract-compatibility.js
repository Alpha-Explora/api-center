#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sharedServicesRoot = process.env.API_SHARED_SERVICES_ROOT
  ? path.resolve(repoRoot, process.env.API_SHARED_SERVICES_ROOT)
  : path.resolve(repoRoot, '..', 'api-shared-services');
const contractPath = path.join(repoRoot, 'docs', 'contracts', 'shared-service-contract.json');
const sharedControllerPath = path.join(repoRoot, 'src', 'shared-services', 'shared-services.controller.ts');
const kafkaControllerPath = path.join(repoRoot, 'src', 'kafka-governance', 'kafka-governance.controller.ts');
const externalPolicyPath = path.join(repoRoot, 'src', 'external', 'guards', 'external-policy.guard.ts');

const violations = [];
const decoratorPatterns = {
  sharedController: /@Controller\(["']shared["']\)/,
  kafkaController: /@Controller\(["']kafka["']\)/,
  kafkaPublish: /@Post\(["']publish["']\)/,
  kafkaGovernance: /@Get\(["']governance["']\)/,
  kafkaSchemas: /@Get\(["']schemas["']\)/,
};

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function assertFileExists(relativePath) {
  const absolutePath = resolveContractPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push(`Missing required file: ${relativePath}`);
    return null;
  }

  return absolutePath;
}

function resolveContractPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const sharedPrefix = '../api-shared-services/';

  if (normalized.startsWith(sharedPrefix)) {
    return path.join(sharedServicesRoot, normalized.slice(sharedPrefix.length));
  }

  return path.join(repoRoot, relativePath);
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
  if (!decoratorPatterns.sharedController.test(sharedControllerSource)) {
    violations.push("Shared services controller is missing @Controller('shared').");
  }

  for (const service of contract.sharedServices || []) {
    const manifestPath = assertFileExists(service.manifest);
    if (!manifestPath) {
      continue;
    }

    const manifest = readJson(manifestPath);
    const expectedEndpoints = manifest.exposes || [];
    const contractEndpoints = service.endpoints || [];
    if (JSON.stringify(contractEndpoints) !== JSON.stringify(expectedEndpoints)) {
      violations.push(
        `Shared service '${service.serviceId}' endpoints do not match manifest exposes list.`,
      );
    }
  }

  const kafkaControllerSource = readText(kafkaControllerPath);

  if (!decoratorPatterns.kafkaController.test(kafkaControllerSource)) {
    violations.push("Kafka governance controller is missing @Controller('kafka').");
  }

  if (!decoratorPatterns.kafkaPublish.test(kafkaControllerSource)) {
    violations.push("Kafka governance controller is missing @Post('publish') endpoint.");
  }

  if (!decoratorPatterns.kafkaGovernance.test(kafkaControllerSource)) {
    violations.push("Kafka governance controller is missing @Get('governance') endpoint.");
  }

  if (!decoratorPatterns.kafkaSchemas.test(kafkaControllerSource)) {
    violations.push("Kafka governance controller is missing @Get('schemas') endpoint.");
  }

  for (const scope of contract.kafkaGovernance?.requiredScopes || []) {
    if (!kafkaControllerSource.includes(scope)) {
      violations.push(`Kafka governance controller is missing required Kafka scope: ${scope}`);
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
