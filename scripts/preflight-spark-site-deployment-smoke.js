#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

const options = {
  serviceId: getArg('--service-id', process.env.APICENTER_SMOKE_SERVICE_ID || 'church-donations'),
  tribeId: getArg('--tribe-id', process.env.APICENTER_SMOKE_TRIBE_ID || process.env.APICENTER_TRIBE_ID || 'church-donations'),
  requiredEnvironments: csvArg('--required-environments', process.env.APICENTER_SMOKE_REQUIRED_ENVIRONMENTS || 'test,live'),
  requiredSharedServices: csvArg(
    '--required-shared-services',
    process.env.APICENTER_SMOKE_REQUIRED_SHARED_SERVICES || 'email,gauth,geo,otp,payment,sms',
  ),
  out: getArg('--out', ''),
  failOnBlockers: args.includes('--fail-on-blockers'),
  checkConfig: args.includes('--check-config'),
  skipDbCheck: args.includes('--skip-db-check'),
  skipSecretCheck: args.includes('--skip-secret-check'),
  project: getArg(
    '--project',
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_QUOTA_PROJECT || '',
  ),
  databaseUrl: process.env.DATABASE_URL || '',
};

async function main() {
  const result = await collectSparkSiteDeploymentPreflight();
  const output = JSON.stringify(result, null, 2);
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, output + '\n', 'utf8');
  }
  console.log(output);

  if (options.failOnBlockers && !options.checkConfig && result.blockers.length > 0) {
    throw new Error(`Spark Site deployment preflight failed: ${result.blockers.join('; ')}`);
  }
}

async function collectSparkSiteDeploymentPreflight() {
  const checks = [];
  const blockers = [];
  const environment = {
    DATABASE_URL: redactedEnvStatus('DATABASE_URL'),
    GCLOUD_PROJECT: redactedEnvStatus('GCLOUD_PROJECT'),
    GOOGLE_CLOUD_PROJECT: redactedEnvStatus('GOOGLE_CLOUD_PROJECT'),
    GOOGLE_CLOUD_QUOTA_PROJECT: redactedEnvStatus('GOOGLE_CLOUD_QUOTA_PROJECT'),
  };

  if (options.checkConfig) {
    return {
      generatedAt: new Date().toISOString(),
      mode: 'check-config',
      serviceId: options.serviceId,
      tribeId: options.tribeId,
      requiredEnvironments: options.requiredEnvironments,
      requiredSharedServices: options.requiredSharedServices,
      secretNames: expectedSecretNames(),
      environment,
      ready: false,
      blockers: ['Configuration preview only; run without --check-config in an operator shell.'],
      checks,
      nextCommands: nextCommands({ blockers: ['Configuration preview only'] }),
    };
  }

  let catalog;
  if (options.skipDbCheck) {
    checks.push(check('catalog.database', true, 'Skipped by --skip-db-check.'));
  } else if (!options.databaseUrl) {
    const message = 'DATABASE_URL is required for catalog preflight.';
    checks.push(check('catalog.database', false, message));
    blockers.push(message);
  } else {
    try {
      catalog = await loadCatalogService(options.databaseUrl, options.serviceId);
      checks.push(check('catalog.database', true, `Loaded ${options.serviceId} from apic_catalog.`));
      evaluateCatalog(catalog, checks, blockers);
    } catch (error) {
      const message = `Catalog preflight failed: ${sanitize(error.message)}`;
      checks.push(check('catalog.database', false, message));
      blockers.push(message);
    }
  }

  let secrets;
  let missingSecrets = [];
  if (options.skipSecretCheck) {
    checks.push(check('secrets.scopedRecords', true, 'Skipped by --skip-secret-check.'));
  } else {
    secrets = await describeExpectedSecrets();
    missingSecrets = secrets.filter((secret) => !secret.exists).map((secret) => secret.name);
    checks.push(
      check(
        'secrets.scopedRecords',
        missingSecrets.length === 0,
        missingSecrets.length === 0
          ? 'All expected environment-scoped tribe Secret Manager records exist.'
          : `Missing environment-scoped tribe Secret Manager records: ${missingSecrets.join(', ')}.`,
      ),
    );
    if (missingSecrets.length > 0) {
      blockers.push(
        `Provision missing environment-scoped tribe secrets through Management: ${missingSecrets.join(', ')}.`,
      );
    }
  }

  checks.push(
    check(
      'payment.providerApproval',
      false,
      'Provider-impacting payment mutation smoke is intentionally not approved by this preflight.',
      'manual',
    ),
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: 'preflight',
    serviceId: options.serviceId,
    tribeId: options.tribeId,
    requiredEnvironments: options.requiredEnvironments,
    requiredSharedServices: options.requiredSharedServices,
    environment,
    catalog,
    secrets,
    ready: blockers.length === 0,
    blockers,
    checks,
    nextCommands: nextCommands({ blockers, missingSecrets }),
  };
}

async function loadCatalogService(databaseUrl, serviceId) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const serviceResult = await client.query(
      [
        'select id, service_id, name, status, owner_tribe_id, service_type, base_url, updated_at',
        'from apic_catalog.services',
        'where service_id = $1',
      ].join('\n'),
      [serviceId],
    );
    if (serviceResult.rowCount === 0) {
      throw new Error(`${serviceId} is not registered in apic_catalog.services.`);
    }
    const service = serviceResult.rows[0];
    const [environmentResult, dependencyResult] = await Promise.all([
      client.query(
        [
          'select environment, base_url, status, healthy, last_health_check_at',
          'from apic_catalog.service_environments',
          'where service_id = $1',
          'order by environment',
        ].join('\n'),
        [service.id],
      ),
      client.query(
        [
          'select coalesce(target.service_id, dependency.depends_on_external_id) as service_id',
          'from apic_catalog.service_dependencies dependency',
          'left join apic_catalog.services target on target.id = dependency.depends_on_service_id',
          'where dependency.service_id = $1',
          'order by service_id',
        ].join('\n'),
        [service.id],
      ),
    ]);

    return {
      serviceId: service.service_id,
      name: service.name,
      status: service.status,
      ownerTribeId: service.owner_tribe_id,
      serviceType: service.service_type,
      baseUrl: service.base_url,
      updatedAt: iso(service.updated_at),
      environments: environmentResult.rows.map((row) => ({
        environment: row.environment,
        baseUrl: row.base_url,
        status: row.status,
        healthy: row.healthy,
        lastHealthCheckAt: iso(row.last_health_check_at),
      })),
      consumes: dependencyResult.rows.map((row) => row.service_id).filter(Boolean),
    };
  } finally {
    await client.end();
  }
}

function evaluateCatalog(catalog, checks, blockers) {
  const statusOk = catalog.status === 'active';
  checks.push(check('catalog.serviceActive', statusOk, `${catalog.serviceId} status is ${catalog.status}.`));
  if (!statusOk) blockers.push(`${catalog.serviceId} must be active before deployment smoke.`);

  const ownerOk = catalog.ownerTribeId === options.tribeId;
  checks.push(
    check(
      'catalog.ownerTribe',
      ownerOk,
      ownerOk
        ? `${catalog.serviceId} is owned by ${options.tribeId}.`
        : `${catalog.serviceId} owner is ${catalog.ownerTribeId || 'unset'}, expected ${options.tribeId}.`,
    ),
  );
  if (!ownerOk) blockers.push(`${catalog.serviceId} owner tribe must be ${options.tribeId}.`);

  const environmentNames = catalog.environments.map((row) => row.environment);
  const missingEnvironments = options.requiredEnvironments.filter(
    (environment) => !environmentNames.includes(environment),
  );
  checks.push(
    check(
      'catalog.environmentRows',
      missingEnvironments.length === 0,
      missingEnvironments.length === 0
        ? `${catalog.serviceId} has required environment rows: ${environmentNames.join(', ')}.`
        : `${catalog.serviceId} is missing environment rows: ${missingEnvironments.join(', ')}. Found: ${environmentNames.join(', ') || 'none'}.`,
    ),
  );
  if (missingEnvironments.length > 0) {
    blockers.push(`${catalog.serviceId} needs environment rows: ${missingEnvironments.join(', ')}.`);
  }

  const missingSharedServices = options.requiredSharedServices.filter(
    (serviceId) => !catalog.consumes.includes(serviceId),
  );
  checks.push(
    check(
      'catalog.requiredSharedServiceDependencies',
      missingSharedServices.length === 0,
      missingSharedServices.length === 0
        ? `${catalog.serviceId} declares required shared-service dependencies.`
        : `${catalog.serviceId} is missing dependencies: ${missingSharedServices.join(', ')}. Found: ${catalog.consumes.join(', ') || 'none'}.`,
    ),
  );
  if (missingSharedServices.length > 0) {
    blockers.push(`${catalog.serviceId} must declare dependencies: ${missingSharedServices.join(', ')}.`);
  }
}

async function describeExpectedSecrets() {
  const names = expectedSecretNames();
  return Promise.all(names.map((name) => describeSecret(name)));
}

async function describeSecret(name) {
  const invocation = resolveGcloudInvocation();
  const gcloudArgs = ['secrets', 'describe', name, '--format=json'];
  if (options.project) gcloudArgs.push('--project', options.project);

  try {
    const { stdout } = await execFileAsync(invocation.file, buildGcloudExecArgs(invocation, gcloudArgs), {
      windowsHide: true,
      timeout: Number(process.env.APICENTER_SMOKE_GCLOUD_TIMEOUT_MS || 15000),
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '{}');
    return {
      name,
      exists: true,
      project: options.project || undefined,
      replication: parsed.replication ? 'configured' : undefined,
      createTime: parsed.createTime,
    };
  } catch (error) {
    return {
      name,
      exists: false,
      project: options.project || undefined,
      error: summarizeSecretDescribeError(error),
    };
  }
}

function buildGcloudExecArgs(invocation, gcloudArgs) {
  return [...invocation.args, ...gcloudArgs];
}

function resolveGcloudInvocation() {
  if (process.platform !== 'win32') {
    return { file: process.env.GCLOUD_BIN || 'gcloud', args: [] };
  }

  if (process.env.GCLOUD_BIN) {
    return { file: process.env.GCLOUD_BIN, args: [] };
  }

  const cmdCandidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
  ];
  const cmd = cmdCandidates.find((candidate) => fs.existsSync(candidate));
  if (cmd) {
    return { file: 'cmd.exe', args: ['/d', '/c', cmd] };
  }

  const ps1Candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.ps1'),
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1',
  ];
  const ps1 = ps1Candidates.find((candidate) => fs.existsSync(candidate));
  if (ps1) {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    };
  }

  return { file: 'gcloud.cmd', args: [] };
}
function summarizeSecretDescribeError(error) {
  const raw = sanitize(error.stderr || error.message || String(error));
  if (/NOT_FOUND|not found/i.test(raw)) return 'NOT_FOUND';
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(raw) || error.killed) return 'GCLOUD_TIMEOUT';
  if (/PERMISSION_DENIED|permission/i.test(raw)) return 'PERMISSION_DENIED';
  return raw.slice(0, 180);
}
function expectedSecretNames() {
  return options.requiredEnvironments.map(
    (environment) => `api-center-tribe-secret-${options.tribeId}-${environment}`,
  );
}

function nextCommands({ blockers = [], missingSecrets = [] } = {}) {
  const commands = [];
  if (missingSecrets.length > 0) {
    commands.push('Provision missing scoped tribe secrets through Management so plaintext is handed off once and not logged.');
  }
  if (blockers.some((blocker) => /environment rows/i.test(blocker))) {
    commands.push('Add the missing live service environment row through the approved registration or Management workflow.');
  }
  commands.push('Run: npm run smoke:spark-site:preflight -- --out docs/operations/spark-site-deployment-preflight-<date>.json');
  if (blockers.length === 0) {
    commands.push('After preflight is ready, run SDK read-only smoke with APICENTER_URL, APICENTER_ENVIRONMENT, APICENTER_TRIBE_ID, APICENTER_SERVICE_ID, and APICENTER_TRIBE_SECRET.');
  }
  commands.push('Run provider-impacting payment smoke only after explicit operator approval.');
  return commands;
}

function check(name, ok, detail, status = ok ? 'pass' : 'fail') {
  return { name, status, ok, detail };
}

function getArg(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function csvArg(name, fallback) {
  return getArg(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function redactedEnvStatus(name) {
  const value = process.env[name];
  return { present: Boolean(value), length: value ? value.length : 0 };
}

function sanitize(value) {
  let output = String(value || '');
  for (const secretName of ['DATABASE_URL']) {
    const secretValue = process.env[secretName];
    if (secretValue) output = output.split(secretValue).join(`<${secretName}>`);
  }
  return output.replace(/postgresql:\/\/[^\s]+/g, 'postgresql://<redacted>');
}

function iso(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { collectSparkSiteDeploymentPreflight };
