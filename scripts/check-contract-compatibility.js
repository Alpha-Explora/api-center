#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sharedServicesRoot = process.env.API_SHARED_SERVICES_ROOT
  ? path.resolve(repoRoot, process.env.API_SHARED_SERVICES_ROOT)
  : path.resolve(repoRoot, '..', 'api-shared-services');
const externalSharedRootAvailable = fs.existsSync(sharedServicesRoot);
const allowMissingExternalManifests =
  process.env.ALLOW_MISSING_EXTERNAL_MANIFESTS === 'true' || !externalSharedRootAvailable;
const allowMissingExternalContracts =
  process.env.ALLOW_MISSING_EXTERNAL_CONTRACTS === 'true' || !externalSharedRootAvailable;
const contractPath = path.join(repoRoot, 'docs', 'contracts', 'shared-service-contract.json');
const sharedControllerPath = path.join(repoRoot, 'apps', 'gateway', 'src', 'shared-services', 'shared-services.controller.ts');
const kafkaControllerPath = path.join(repoRoot, 'apps', 'gateway', 'src', 'kafka-governance', 'kafka-governance.controller.ts');
const externalPolicyPath = path.join(repoRoot, 'apps', 'gateway', 'src', 'external', 'guards', 'external-policy.guard.ts');
const openApiPath = path.join(repoRoot, 'docs', 'openapi', 'openapi.json');
const authTokenContractPath = process.env.APICENTER_AUTH_TOKEN_CONTRACT_PATH
  ? path.resolve(repoRoot, process.env.APICENTER_AUTH_TOKEN_CONTRACT_PATH)
  : path.resolve(repoRoot, '..', 'api-shared-services', 'contracts', 'apicenter-auth-token.schema.json');

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
  const resolved = resolveContractPath(relativePath);
  const absolutePath = resolved.absolutePath;
  if (!fs.existsSync(absolutePath)) {
    if (resolved.externalSharedManifest && allowMissingExternalManifests) {
      console.warn(
        `Skipping unavailable external shared-service manifest: ${relativePath}`,
      );
      return null;
    }

    violations.push(`Missing required file: ${relativePath}`);
    return null;
  }

  return absolutePath;
}

function resolveContractPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const sharedPrefix = '../api-shared-services/';

  if (normalized.startsWith(sharedPrefix)) {
    return {
      absolutePath: path.join(sharedServicesRoot, normalized.slice(sharedPrefix.length)),
      externalSharedManifest: true,
    };
  }

  return {
    absolutePath: path.join(repoRoot, relativePath),
    externalSharedManifest: false,
  };
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

  if (!assertFileExists('apps/gateway/src/shared-services/shared-services.controller.ts')) {
    return;
  }
  if (!assertFileExists('apps/gateway/src/kafka-governance/kafka-governance.controller.ts')) {
    return;
  }
  if (!assertFileExists('apps/gateway/src/external/guards/external-policy.guard.ts')) {
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

function resolveOpenApiSchema(schema, doc) {
  if (!schema) {
    return null;
  }

  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, '').split('/');
    return resolveOpenApiSchema(
      parts.reduce((current, part) => current?.[part], doc),
      doc,
    );
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce(
      (merged, item) => {
        const resolved = resolveOpenApiSchema(item, doc) || {};
        return {
          ...merged,
          ...resolved,
          required: [...new Set([...(merged.required || []), ...(resolved.required || [])])],
          properties: { ...(merged.properties || {}), ...(resolved.properties || {}) },
        };
      },
      { type: 'object', required: [], properties: {} },
    );
  }

  return schema;
}

function getAuthTokenSchemas(openApi) {
  const operation = openApi.paths?.['/api/v1/auth/token']?.post;
  const requestSchema = resolveOpenApiSchema(
    operation?.requestBody?.content?.['application/json']?.schema,
    openApi,
  );
  const responseContent =
    operation?.responses?.['201']?.content?.['application/json'] ||
    operation?.responses?.['200']?.content?.['application/json'];
  const responseWrapper = resolveOpenApiSchema(responseContent?.schema, openApi);
  const responseSchema = resolveOpenApiSchema(
    responseWrapper?.properties?.data || responseWrapper,
    openApi,
  );

  return { requestSchema, responseSchema };
}

function assertRequiredFields(schema, expectedFields, context) {
  const required = new Set(schema?.required || []);
  for (const field of expectedFields) {
    if (!required.has(field)) {
      violations.push(`${context} is missing required field '${field}'.`);
    }
  }
}

function assertProperties(schema, expectedFields, context) {
  for (const field of expectedFields) {
    if (!schema?.properties?.[field]) {
      violations.push(`${context} is missing property '${field}'.`);
    }
  }
}

function assertEnvironmentEnum(schema, context) {
  const environment = resolveOpenApiSchema(schema?.properties?.environment, schema) || schema?.properties?.environment;
  const actual = environment?.enum || [];
  const expected = ['test', 'live'];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    violations.push(`${context} environment enum must be ${expected.join(', ')}; got ${actual.join(', ') || 'none'}.`);
  }
}

function ensureAuthTokenOpenApiContract() {
  if (!fs.existsSync(openApiPath)) {
    violations.push('Missing generated OpenAPI artifact: docs/openapi/openapi.json. Run npm run openapi:generate.');
    return;
  }
  if (!fs.existsSync(authTokenContractPath)) {
    if (allowMissingExternalContracts) {
      console.warn(`Skipping unavailable external auth token contract: ${authTokenContractPath}`);
      return;
    }
    violations.push(`Missing APICenter auth token contract: ${authTokenContractPath}`);
    return;
  }

  const openApi = readJson(openApiPath);
  const contract = readJson(authTokenContractPath);
  const { requestSchema, responseSchema } = getAuthTokenSchemas(openApi);

  if (!requestSchema) {
    violations.push('OpenAPI is missing POST /api/v1/auth/token request schema.');
    return;
  }
  if (!responseSchema) {
    violations.push('OpenAPI is missing POST /api/v1/auth/token response data schema.');
    return;
  }

  const requiredRequest = contract.request?.required || [];
  const optionalRequest = contract.request?.optional || [];
  const allowedRequest = new Set([...requiredRequest, ...optionalRequest]);
  const actualRequestProperties = Object.keys(requestSchema.properties || {});

  assertRequiredFields(requestSchema, requiredRequest, 'Auth token request');
  assertProperties(requestSchema, [...allowedRequest], 'Auth token request');
  for (const field of actualRequestProperties) {
    if (!allowedRequest.has(field)) {
      violations.push(`Auth token request exposes unexpected field '${field}'.`);
    }
  }
  if ((requestSchema.required || []).includes('sourceServiceId')) {
    violations.push('Auth token request field sourceServiceId must remain optional.');
  }
  assertEnvironmentEnum(requestSchema, 'Auth token request');

  const requiredResponse = contract.response?.required || [];
  assertRequiredFields(responseSchema, requiredResponse, 'Auth token response data');
  assertProperties(responseSchema, requiredResponse, 'Auth token response data');
  assertEnvironmentEnum(responseSchema, 'Auth token response data');
}
function main() {
  runContractChecks();
  ensureAuthTokenOpenApiContract();

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
